import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';

import { auth } from '@clerk/nextjs/server';
import { Chat } from '@/components/chat';
import { getChatById, getMessagesByChatId } from '@/lib/db/queries';
import { DataStreamHandler } from '@/components/data-stream-handler';
import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models';
import { DBMessage } from '@/lib/db/schema';
import { Attachment, UIMessage } from 'ai';

export default async function Page({ params }: { params: { id: string } }) {
  const chatId = params.id; // Access id inside the function body
  const { userId } = await auth();

  if (!userId) {
    // Defensive check, should be handled by middleware
    redirect(`/sign-in?redirect_url=/chat/${chatId}`);
  }

  const chat = await getChatById({ id: chatId, userId });

  if (!chat) {
    notFound();
  }

  const messagesFromDb = await getMessagesByChatId({
    id: chatId,
  });

  function convertToUIMessages(messages: Array<DBMessage>): Array<UIMessage> {
    return messages.map((message) => ({
      id: message.id,
      parts: message.parts as UIMessage['parts'],
      role: message.role as UIMessage['role'],
      // Note: content will soon be deprecated in @ai-sdk/react
      content: '',
      createdAt: message.createdAt,
      experimental_attachments:
        (message.attachments as Array<Attachment>) ?? [],
    }));
  }

  const cookieStore = await cookies();
  const chatModelFromCookie = cookieStore.get('chat-model');

  if (!chatModelFromCookie) {
    return (
      <>
        <Chat
          id={chatId}
          initialMessages={convertToUIMessages(messagesFromDb)}
          selectedChatModel={DEFAULT_CHAT_MODEL}
          selectedVisibilityType={chat.visibility}
          isReadonly={userId !== chat.userId}
        />
        <DataStreamHandler id={chatId} />
      </>
    );
  }

  return (
    <>
      <Chat
        id={chatId}
        initialMessages={convertToUIMessages(messagesFromDb)}
        selectedChatModel={chatModelFromCookie.value}
        selectedVisibilityType={chat.visibility}
        isReadonly={userId !== chat.userId}
      />
      <DataStreamHandler id={chatId} />
    </>
  );
}
