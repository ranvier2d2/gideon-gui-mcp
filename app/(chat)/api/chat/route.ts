import {
  UIMessage,
  appendResponseMessages,
  createDataStreamResponse,
  smoothStream,
  streamText,
  CoreTool, // Import CoreTool from 'ai'
  experimental_createMCPClient, // Revert source to 'ai'
} from 'ai';
import { Experimental_StdioMCPTransport } from 'ai/mcp-stdio'; // Source is 'ai/mcp-stdio'
import { auth, clerkClient } from '@clerk/nextjs/server'; 
import { systemPrompt, gideonMCPSystemPrompt } from '@/lib/ai/prompts';
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
import { createOpenAI } from '@ai-sdk/openai'; // Added import

// Define MCP Tool Descriptions (Placeholder - ideally fetch dynamically)
const mcpToolDescriptions: Record<string, string> = {
  'semantic-scholar-search': 'Performs a search on Semantic Scholar for academic papers.',
  'store-patient-note': 'Stores a patient note.',
  'web-search': 'Performs a web search using Brave Search API.',
  'bayesian-update': 'Calculates posterior probability using Bayes theorem.',
  'likelihood-ratio': 'Calculates positive and negative likelihood ratios.',
  'generate-decision-tree': 'Generates a diagnostic decision tree based on hypotheses and tests.',
  'compare-hypotheses': 'Compares hypotheses based on evidence.',
  'optimize-test-sequence': 'Optimizes the sequence of diagnostic tests.',
  'evaluate-intervention-window': 'Evaluates the therapeutic window for a condition.',
};

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

    const chat = await getChatById({ id, userId });

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

    let mcpClient: any = null; // Declare outside for closure access

    return createDataStreamResponse({
      execute: async (dataStream) => { // Make callback async
        let mcpToolsFormatted: Record<string, any> = {};

        // --- Try connecting to MCP Server and fetching tools --- 
        try {
          const mcpServerScriptPath = process.env.MCP_SERVER_SCRIPT_PATH;

          if (!mcpServerScriptPath) {
            console.warn('MCP_SERVER_SCRIPT_PATH environment variable not set. Skipping MCP tools.');
          } else {
            const braveApiKey = process.env.BRAVE_API_KEY;
            if (!braveApiKey) {
              throw new Error('BRAVE_API_KEY environment variable not set for MCP.');
            }

            const mcpEnv = {
              ...process.env,
              BRAVE_API_KEY: braveApiKey,
            };

            const transport = new Experimental_StdioMCPTransport({
              command: 'npx',
              args: ['-y', 'tsx', mcpServerScriptPath],
              env: mcpEnv,
            });

            mcpClient = await experimental_createMCPClient({ transport });
            const rawMcpTools = await mcpClient.tools();

            // Debug logs for fetched tools
            console.log('Raw tools received from mcpClient.tools():');
            console.dir(rawMcpTools, { depth: null });
            console.log('Fetched tool names from MCP server:', Object.keys(rawMcpTools));

            // Assign MCP tools directly (format seems compatible)
            mcpToolsFormatted = rawMcpTools;
          }
        } catch (mcpError) {
          console.error('Failed to connect to MCP server or fetch/format tools:', mcpError);
          console.log('Proceeding with only local tools.');
          // Ensure mcpClient is nullified if connection failed
          if (mcpClient) {
             try { await mcpClient.close(); } catch (e) { /* ignore */ }
             mcpClient = null;
          }
        }

        // --- Define Local Tools (now with dataStream) --- 
        const localToolsWithStream = {
          getWeather, // Assuming getWeather doesn't need dataStream
          createDocument: createDocument({ userId, dataStream }),
          updateDocument: updateDocument({ userId, dataStream }),
          requestSuggestions: requestSuggestions({ userId, dataStream }),
        };

        // --- Merge All Tools --- 
        const allTools = {
          ...localToolsWithStream,
          ...mcpToolsFormatted, 
        };

        console.log('Merged tool names being passed to streamText:', Object.keys(allTools));

        // --- Execute streamText --- 
        const result = streamText({
          model: myProvider.languageModel(selectedChatModel), // Fixed method name
          system: `${systemPrompt({ selectedChatModel })}\n\n${gideonMCPSystemPrompt}`,
          messages,
          maxSteps: 5,
          experimental_transform: smoothStream({ chunking: 'word' }),
          experimental_generateMessageId: generateUUID,
          tools: allTools,
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

            // --- Close MCP Client (if open) --- 
            if (mcpClient) {
              try {
                await mcpClient.close();
                console.log('MCP client closed successfully.');
              } catch (closeError) {
                console.error('Error closing MCP client:', closeError);
              }
            }
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: 'stream-text',
          },
        }); // End of streamText

        // --- Stream Handling --- 
        result.consumeStream(); 
        result.mergeIntoDataStream(dataStream, { sendReasoning: true });

        // --- Abort Handling --- 
        request.signal?.addEventListener('abort', async () => {
          if (mcpClient) {
            try {
              await mcpClient.close();
              console.log('MCP client closed due to request abort.');
            } catch (abortCloseError) {
              console.error('Error closing MCP client on abort:', abortCloseError);
            }
          }
        });
      }, // End of execute callback
      onError: () => {
        return 'Oops, an error occurred!';
      },
    }); // End of createDataStreamResponse
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
    const chatToDelete = await getChatById({ id, userId });

    if (!chatToDelete) {
      return new Response('Chat not found or unauthorized', { status: 404 });
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
