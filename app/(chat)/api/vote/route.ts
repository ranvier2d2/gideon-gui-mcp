import { auth } from '@clerk/nextjs/server';
import { getChatById, getVotesByChatId, voteMessage } from '@/lib/db/queries';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get('chatId');

  if (!chatId) {
    return new Response('chatId is required', { status: 400 });
  }

  // Get userId from Clerk
  const { userId } = await auth();

  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const chat = await getChatById({ id: chatId, userId });

  if (!chat) {
    return new Response('Chat not found', { status: 404 });
  }

  // Check if the authenticated user owns the chat
  if (chat.userId !== userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const votes = await getVotesByChatId({ id: chatId });

  return Response.json(votes, { status: 200 });
}

export async function PATCH(request: Request) {
  const {
    chatId,
    messageId,
    type,
  }: { chatId: string; messageId: string; type: 'up' | 'down' } =
    await request.json();

  if (!chatId || !messageId || !type) {
    return new Response('messageId and type are required', { status: 400 });
  }

  // Get userId from Clerk
  const { userId } = await auth();

  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const chat = await getChatById({ id: chatId, userId });

  if (!chat) {
    return new Response('Chat not found', { status: 404 });
  }

  // Check if the authenticated user owns the chat
  if (chat.userId !== userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    await voteMessage({ chatId, messageId, type, userId });
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error('Error voting on message:', error);
  }
}
