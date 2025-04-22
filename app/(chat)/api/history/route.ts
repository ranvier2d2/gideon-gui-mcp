import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextRequest } from 'next/server';
// Assuming these exist - verification needed later
import { getChatsByUserId, getUserById, createClerkUser } from '@/lib/db/queries';

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
    // --- JIT User Synchronization Start ---
    let localUser = await getUserById({ id: userId });

    if (!localUser) {
      console.log(`User ${userId} not found locally. Fetching from Clerk...`);
      try {
        const clerkUser = await (await clerkClient()).users.getUser(userId);

        // Extract primary email address
        const primaryEmail = clerkUser.emailAddresses.find(
          (email: { id: string; emailAddress: string }) => email.id === clerkUser.primaryEmailAddressId
        )?.emailAddress;

        if (!primaryEmail) {
          console.error(`Primary email not found for Clerk user ${userId}`);
          return Response.json('User profile incomplete', { status: 500 });
        }

        console.log(`Creating user ${userId} with email ${primaryEmail} locally...`);
        await createClerkUser({ id: userId, email: primaryEmail });
        // Optionally re-fetch or assume createClerkUser returns the user/success
        // localUser = await getUserById({ id: userId }); // Re-fetch if needed

      } catch (syncError) {
        console.error(`Failed to sync user ${userId}:`, syncError);
        // Decide if this is a fatal error for the request
        return Response.json('Failed to synchronize user data', { status: 500 });
      }
    }
    // --- JIT User Synchronization End ---

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
