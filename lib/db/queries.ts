import 'server-only';

import { genSaltSync, hashSync } from 'bcrypt-ts';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  type SQL,
} from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  user,
  chat,
  type User,
  document,
  type Suggestion,
  suggestion,
  message,
  vote,
  type DBMessage,
  type Chat,
} from './schema';
import type { ArtifactKind } from '@/components/artifact';

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle

// biome-ignore lint: Forbidden non-null assertion.
const client = postgres(process.env.POSTGRES_URL!);
const db = drizzle(client);

export async function getUser(email: string): Promise<Array<User>> {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (error) {
    console.error('Failed to get user from database');
    throw error;
  }
}

export async function getUserById({ id }: { id: string }): Promise<User | undefined> {
  try {
    const result = await db.select().from(user).where(eq(user.id, id)).limit(1);
    return result[0]; // Return the first user found or undefined
  } catch (error) {
    console.error('Failed to get user by id from database');
    throw error;
  }
}

export async function createLocalUser(email: string, password: string) {
  const salt = genSaltSync(10);
  const hash = hashSync(password, salt);

  try {
    // Use returning() to get the inserted user data if needed
    return await db.insert(user).values({ email, password: hash }).returning();
  } catch (error) {
    console.error('Failed to create local user in database');
    throw error;
  }
}

export async function createClerkUser({ id, email }: { id: string, email: string }) {
  try {
    // Insert user with id and email, password remains null (its default or omitted)
    // Use returning() to get the inserted user data if needed
    return await db.insert(user).values({ id, email }).returning();
    // Consider adding onConflictDoUpdate if emails might change in Clerk and need syncing
    /*
    return await db.insert(user)
      .values({ id, email })
      .onConflict(user.id)
      .doUpdate({ set: { email: email } })
      .returning();
    */
  } catch (error) {
    console.error('Failed to create clerk user in database');
    throw error;
  }
}

export async function saveChat({
  id,
  userId,
  title,
}: {
  id: string;
  userId: string;
  title: string;
}) {
  try {
    return await db.insert(chat).values({
      id,
      createdAt: new Date(),
      userId,
      title,
    });
  } catch (error) {
    console.error('Failed to save chat in database');
    throw error;
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await db.delete(vote).where(eq(vote.chatId, id));
    await db.delete(message).where(eq(message.chatId, id));

    return await db.delete(chat).where(eq(chat.id, id));
  } catch (error) {
    console.error('Failed to delete chat by id from database');
    throw error;
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<any>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id),
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Array<Chat> = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new Error(`Chat with id ${startingAfter} not found`);
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new Error(`Chat with id ${endingBefore} not found`);
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (error) {
    console.error('Failed to get chats by user from database');
    throw error;
  }
}

export async function getChatById({ id, userId }: { id: string; userId: string }) {
  try {
    const [selectedChat] = await db
      .select()
      .from(chat)
      .where(and(eq(chat.id, id), eq(chat.userId, userId))) // Add userId check
      .limit(1);
    return selectedChat;
  } catch (error) {
    console.error('Failed to get chat by id from database');
    throw error;
  }
}

export async function saveMessages({
  messages,
}: {
  messages: Array<DBMessage>;
}) {
  try {
    return await db.insert(message).values(messages);
  } catch (error) {
    console.error('Failed to save messages in database', error);
    throw error;
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (error) {
    console.error('Failed to get messages by chat id from database', error);
    throw error;
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
  userId,
}: {
  chatId: string;
  messageId: string;
  type: 'up' | 'down';
  userId: string;
}) {
  try {
    // First, verify the user owns the chat
    const chatToVerify = await getChatById({ id: chatId, userId });

    if (!chatToVerify) {
      // Or handle as appropriate - maybe just return silently?
      throw new Error(`Chat not found: ${chatId}`);
    }

    if (chatToVerify.userId !== userId) {
      // Prevent unauthorized deletion
      console.error(`User ${userId} attempted to vote on message in chat ${chatId} owned by ${chatToVerify.userId}`);
      throw new Error('Unauthorized: User does not own this chat');
    }

    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === 'up' })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db.insert(vote).values({
      chatId,
      messageId,
      isUpvoted: type === 'up',
    });
  } catch (error) {
    console.error('Failed to upvote message in database', error);
    throw error;
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (error) {
    console.error('Failed to get votes by chat id from database', error);
    throw error;
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  try {
    return await db
      .insert(document)
      .values({
        id,
        title,
        kind,
        content,
        userId,
        createdAt: new Date(),
      })
      .returning({ // Explicitly define returning columns
        id: document.id,
        createdAt: document.createdAt,
        title: document.title,
        content: document.content,
        kind: document.kind, // Use schema name, Drizzle handles mapping if aliased correctly in select
        userId: document.userId,
      });
  } catch (error) {
    // Log the specific database error for better diagnosis
    console.error('Failed to save document in database:', error);
    throw error;
  }
}

export async function getDocumentsById({
  ids,
  userId,
}: {
  ids: string[];
  userId: string;
}) {
  try {
    return await db
      .select({ // Explicitly define selection
        id: document.id,
        createdAt: document.createdAt,
        title: document.title,
        content: document.content,
        kind: document.kind, // Use schema name, Drizzle handles mapping if aliased correctly
        userId: document.userId,
      })
      .from(document)
      .where(and(inArray(document.id, ids), eq(document.userId, userId)))
      .orderBy(desc(document.createdAt));
  } catch (error) {
    console.error('Failed to get documents by id from database');
    throw error;
  }
}

export async function getDocumentById({
  id,
  userId, // Add userId parameter
}: {
  id: string;
  userId: string; // Add userId type
}) {
  try {
    const [selectedDocument] = await db
      .select({
        id: document.id,
        createdAt: document.createdAt,
        title: document.title,
        content: document.content,
        kind: document.kind, // Explicitly select 'kind' field
        userId: document.userId,
      })
      .from(document)
      .where(and(eq(document.id, id), eq(document.userId, userId))) // Check both id and userId
      .limit(1);

    return selectedDocument;
  } catch (error) {
    console.error('Failed to get document by id from database');
    throw error;
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
  userId, // Add userId parameter
}: {
  id: string;
  timestamp: Date;
  userId: string; // Add userId type definition
}) {
  try {
    // NOTE: Deleting suggestions first based only on documentId and timestamp.
    // This implicitly relies on the document delete check below to ensure authorization.
    // If suggestions had their own userId column, we'd check it here too.
    await db
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp),
        ),
      );

    return await db
      .delete(document)
      .where(
        and(
          eq(document.id, id),
          eq(document.userId, userId), // Add userId check
          gt(document.createdAt, timestamp),
        ),
      )
      .returning();
  } catch (error) {
    console.error(
      'Failed to delete documents by id after timestamp from database',
    );
    throw error;
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Array<Suggestion>;
}) {
  try {
    return await db.insert(suggestion).values(suggestions);
  } catch (error) {
    console.error('Failed to save suggestions in database');
    throw error;
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
  userId, // Add userId parameter
}: {
  documentId: string;
  userId: string; // Add userId type
}) {
  try {
    // First, verify the user owns the document
    const doc = await getDocumentById({ id: documentId, userId });

    if (!doc) {
      // Document not found or user does not have access
      console.warn(
        `Attempt to get suggestions for document ${documentId} failed. Document not found or user ${userId} unauthorized.`,
      );
      // Return empty array or throw error based on desired behavior
      return []; // Return empty array for now
      // Alternatively: throw new Error('Document not found or unauthorized');
    }

    // Proceed with fetching suggestions since ownership is verified
    return await db
      .select({ // Explicitly select suggestion columns
        id: suggestion.id,
        documentId: suggestion.documentId,
        documentCreatedAt: suggestion.documentCreatedAt,
        originalText: suggestion.originalText,
        suggestedText: suggestion.suggestedText,
        description: suggestion.description,
        isResolved: suggestion.isResolved,
        userId: suggestion.userId,
        createdAt: suggestion.createdAt,
      })
      .from(suggestion)
      .where(and(eq(suggestion.documentId, documentId)));
  } catch (error) {
    console.error(
      'Failed to get suggestions by document version from database',
    );
    throw error;
  }
}

export async function getMessageById({
  id,
  userId,
}: {
  id: string;
  userId: string;
}) {
  try {
    // Join with chat table to verify ownership via userId
    const result = await db
      .select({
        // Select only message fields explicitly
        id: message.id,
        chatId: message.chatId,
        role: message.role,
        parts: message.parts,
        attachments: message.attachments,
        createdAt: message.createdAt,
      })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(and(eq(message.id, id), eq(chat.userId, userId)))
      .limit(1);

    return result[0]; // Return the first message found or undefined
  } catch (error) {
    console.error('Failed to get message by id from database');
    throw error;
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
  userId, // Add userId parameter
}: {
  chatId: string;
  timestamp: Date;
  userId: string; // Add userId type
}) {
  try {
    // First, verify the user owns the chat
    const chatToVerify = await getChatById({ id: chatId, userId });

    if (!chatToVerify) {
      // Or handle as appropriate - maybe just return silently?
      throw new Error(`Chat not found: ${chatId}`);
    }

    if (chatToVerify.userId !== userId) {
      // Prevent unauthorized deletion
      console.error(`User ${userId} attempted to delete messages from chat ${chatId} owned by ${chatToVerify.userId}`);
      throw new Error('Unauthorized: User does not own this chat');
    }

    // Proceed with deletion since ownership is verified
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp)),
      );

    const messageIds = messagesToDelete.map((message) => message.id);

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds)),
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds)),
        );
    }
  } catch (error) {
    console.error(
      'Failed to delete messages by id after timestamp from database',
    );
    throw error;
  }
}

export async function updateChatVisiblityById({
  id,
  visibility,
  userId, // Add userId parameter
}: {
  id: string;
  visibility: 'private' | 'public';
  userId: string; // Add userId type
}) {
  try {
    return await db
      .update(chat)
      .set({ visibility })
      .where(and(eq(chat.id, id), eq(chat.userId, userId))) // Check both id and userId
      .returning();
  } catch (error) {
    console.error('Failed to update chat visibility in database');
    throw error;
  }
}
