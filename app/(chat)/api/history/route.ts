import { auth } from '@clerk/nextjs/server';
import { NextRequest } from 'next/server';
import { getChatsByUserId } from '@/lib/db/queries';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const limit = parseInt(searchParams.get('limit') || '10');
  const startingAfter = searchParams.get('starting_after');
  const endingBefore = searchParams.get('ending_before');

  if (startingAfter && endingBefore) {
    return Response.json(
      'Only one of starting_after or ending_before can be provided!',
      { status: 400 },
    );
  }

  const { userId } = await auth();

  if (!userId) {
    return Response.json('Unauthorized!', { status: 401 });
  }

  try {
    // TODO: Implement Just-in-Time User Sync: Check if userId exists in local DB,
    // if not, fetch from Clerk and insert.

    const chats = await getChatsByUserId({
      id: userId,
      limit,
      startingAfter,
      endingBefore,
    });

    return Response.json(chats);
  } catch (error) {
    console.error('Failed to fetch chats:', error);
    return Response.json('Failed to fetch chats!', { status: 500 });
  }
}
