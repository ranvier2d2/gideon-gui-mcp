'use server';

import { generateText, Message } from 'ai';
import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';

import {
  deleteMessagesByChatIdAfterTimestamp,
  getMessageById,
  updateChatVisiblityById,
} from '@/lib/db/queries';
import { VisibilityType } from '@/components/visibility-selector';
import { myProvider } from '@/lib/ai/providers';

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set('chat-model', model);
}

export async function generateTitleFromUserMessage({
  message,
}: {
  message: Message;
}) {
  const { text: title } = await generateText({
    model: myProvider.languageModel('title-model'),
    system: `\n
    - you will generate a short title based on the first message a user begins a conversation with
    - ensure it is not more than 80 characters long
    - the title should be a summary of the user's message
    - do not use quotes or colons`,
    prompt: JSON.stringify(message),
  });

  return title;
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  const { userId } = await auth();

  if (!userId) {
    console.error('Unauthorized attempt to delete trailing messages.');
    throw new Error('Unauthorized');
  }

  const message = await getMessageById({ id, userId });

  await deleteMessagesByChatIdAfterTimestamp({
    chatId: message.chatId,
    timestamp: message.createdAt,
    userId,
  });
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  const authResult = await auth();
  const userId = authResult?.userId;

  if (!userId) {
    console.error('Unauthorized attempt to update chat visibility.');
    throw new Error('Unauthorized');
  }

  await updateChatVisiblityById({
    id: chatId,
    visibility,
    userId,
  });
}
