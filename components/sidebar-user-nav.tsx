'use client';
import { UserButton } from '@clerk/nextjs';

export function SidebarUserNav() {
  return (
    // Clerk's UserButton handles its own UI and logic based on auth state
    <UserButton afterSignOutUrl="/" />
  );
}
