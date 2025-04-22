'use server';

import { getSuggestionsByDocumentId } from '@/lib/db/queries';
import { auth } from '@clerk/nextjs/server';

export async function getSuggestions({ documentId }: { documentId: string }) {
  const { userId } = await auth();

  if (!userId) {
    // Should not happen if middleware is set up correctly, but good practice
    console.error('Unauthorized attempt to get suggestions.');
    throw new Error('Unauthorized');
  }

  const suggestions = await getSuggestionsByDocumentId({ documentId, userId });
  return suggestions ?? [];
}
