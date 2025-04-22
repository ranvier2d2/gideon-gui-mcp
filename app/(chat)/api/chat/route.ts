import {
  UIMessage,
  appendResponseMessages,
  createDataStreamResponse,
  smoothStream,
  streamText,
} from 'ai';
import { auth, clerkClient } from '@clerk/nextjs/server'; 
import { systemPrompt } from '@/lib/ai/prompts';
import {
  deleteChatById,
  getChatById,
  getUserById,
  createClerkUser,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import {
  generateUUID,
  getMostRecentUserMessage,
  getTrailingMessageId,
} from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { createDocument } from '@/lib/ai/tools/create-document';
import { updateDocument } from '@/lib/ai/tools/update-document';
import { requestSuggestions } from '@/lib/ai/tools/request-suggestions';
import { getWeather } from '@/lib/ai/tools/get-weather';
import { isProductionEnvironment } from '@/lib/constants';
import { myProvider } from '@/lib/ai/providers';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const {
      id,
      messages,
      selectedChatModel,
    }: {
      id: string;
      messages: Array<UIMessage>;
      selectedChatModel: string;
    } = await request.json();

    const { userId } = await auth(); 

    if (!userId) { 
      return new Response('Unauthorized', { status: 401 });
    }

    // --- JIT User Synchronization Start ---
    let localUser = await getUserById({ id: userId });

    if (!localUser) {
      console.log(`User ${userId} not found locally. Fetching from Clerk...`);
      try {
        const clerkUser = await (await clerkClient()).users.getUser(userId);

        const primaryEmail = clerkUser.emailAddresses.find(
          (email: { id: string; emailAddress: string }) => email.id === clerkUser.primaryEmailAddressId
        )?.emailAddress;

        if (!primaryEmail) {
          console.error(`Primary email not found for Clerk user ${userId}`);
          return Response.json('User profile incomplete', { status: 500 });
        }

        console.log(`Creating user ${userId} with email ${primaryEmail} locally...`);
        await createClerkUser({ id: userId, email: primaryEmail });

      } catch (syncError) {
        console.error(`Failed to sync user ${userId}:`, syncError);
        return Response.json('Failed to synchronize user data', { status: 500 });
      }
    }
    // --- JIT User Synchronization End ---

    const userMessage = getMostRecentUserMessage(messages);

    if (!userMessage) {
      return new Response('No user message found', { status: 400 });
    }

    const chat = await getChatById({ id });

    if (!chat) {
      const title = await generateTitleFromUserMessage({
        message: userMessage,
      });

      await saveChat({ id, userId: userId, title }); 
    } else {
      if (chat.userId !== userId) { 
        return new Response('Unauthorized', { status: 401 });
      }
    }

    await saveMessages({
      messages: [
        {
          chatId: id,
          id: userMessage.id,
          role: 'user',
          parts: userMessage.parts,
          attachments: userMessage.experimental_attachments ?? [],
          createdAt: new Date(),
        },
      ],
    });

    return createDataStreamResponse({
      execute: (dataStream) => {
        const result = streamText({
          model: myProvider.languageModel(selectedChatModel),
          system: systemPrompt({ selectedChatModel }),
          messages,
          maxSteps: 5,
          experimental_activeTools:
            selectedChatModel === 'chat-model-reasoning'
              ? []
              : [
                  'getWeather',
                  'createDocument',
                  'updateDocument',
                  'requestSuggestions',
                ],
          experimental_transform: smoothStream({ chunking: 'word' }),
          experimental_generateMessageId: generateUUID,
          tools: {
            getWeather, 
            createDocument: createDocument({ userId, dataStream }),
            updateDocument: updateDocument({ userId, dataStream }),
            requestSuggestions: requestSuggestions({
              userId,
              dataStream,
            }),
          },
          onFinish: async ({ response }) => {
            const { userId: finishUserId } = await auth();
            if (finishUserId) {
              try {
                const assistantId = getTrailingMessageId({
                  messages: response.messages.filter(
                    (message) => message.role === 'assistant',
                  ),
                });

                if (!assistantId) {
                  throw new Error('No assistant message found!');
                }

                const [, assistantMessage] = appendResponseMessages({
                  messages: [userMessage],
                  responseMessages: response.messages,
                });

                await saveMessages({
                  messages: [
                    {
                      id: assistantId,
                      chatId: id,
                      role: assistantMessage.role,
                      parts: assistantMessage.parts,
                      attachments:
                        assistantMessage.experimental_attachments ?? [],
                      createdAt: new Date(),
                    },
                  ],
                });
              } catch (_) {
                console.error('Failed to save chat');
              }
            }
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: 'stream-text',
          },
        });

        result.consumeStream();

        result.mergeIntoDataStream(dataStream, {
          sendReasoning: true,
        });
      },
      onError: () => {
        return 'Oops, an error occurred!';
      },
    });
  } catch (error) {
    console.error('Chat POST error:', error); 
    return new Response('An error occurred while processing your request!', {
      status: 500, 
    });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('Not Found', { status: 404 });
  }

  const { userId } = await auth(); 

  if (!userId) { 
    return new Response('Unauthorized', { status: 401 });
  }

  // --- JIT User Synchronization Start ---
  let localUserDelete = await getUserById({ id: userId }); 

  if (!localUserDelete) {
    console.log(`User ${userId} not found locally. Fetching from Clerk...`);
    try {
      const clerkUser = await (await clerkClient()).users.getUser(userId);

      const primaryEmail = clerkUser.emailAddresses.find(
        (email: { id: string; emailAddress: string }) => email.id === clerkUser.primaryEmailAddressId
      )?.emailAddress;

      if (!primaryEmail) {
        console.error(`Primary email not found for Clerk user ${userId}`);
        return Response.json('User profile incomplete', { status: 500 });
      }

      console.log(`Creating user ${userId} with email ${primaryEmail} locally...`);
      await createClerkUser({ id: userId, email: primaryEmail });

    } catch (syncError) {
      console.error(`Failed to sync user ${userId}:`, syncError);
      return Response.json('Failed to synchronize user data', { status: 500 });
    }
  }
  // --- JIT User Synchronization End ---

  try {
    const chat = await getChatById({ id });

    if (chat.userId !== userId) { 
      return new Response('Unauthorized', { status: 401 });
    }

    await deleteChatById({ id });

    return new Response('Chat deleted', { status: 200 });
  } catch (error) {
    console.error('Chat DELETE error:', error); 
    return new Response('An error occurred while processing your request!', {
      status: 500,
    });
  }
}
