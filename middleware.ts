import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Define routes that should be publicly accessible
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)', // Clerk sign-in routes
  '/sign-up(.*)', // Clerk sign-up routes
  '/api/webhooks/clerk(.*)', // Clerk webhook handler
  '/favicon.ico',
  '/_next(.*)', // Next.js internal assets
]);

export default clerkMiddleware((auth, req) => {
  // Protect routes that are not public
  if (!isPublicRoute(req)) {
    auth.protect(); // Use auth object directly from handler argument
  }
});

export const config = {
  // The following routes are potentially public or handled by Clerk:
  // - /sign-in, /sign-up (Clerk default paths)
  // - /login, /register (potential old paths, might need removal later)
  // Matcher avoids running middleware on static files and _next internal paths.
  matcher: ['/((?!.*\.\w+|_next).*)', '/', '/(api|trpc)(.*)'],
};
