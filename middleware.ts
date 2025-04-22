import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Define routes that should be protected
const isProtectedRoute = createRouteMatcher([
  '/', // Protect the root route
  '/api/(.*)', // Protect all API routes
]);

export default clerkMiddleware((auth, req) => {
  if (isProtectedRoute(req)) {
    auth.protect(); // Protect the route if it matches
  }
});

export const config = {
  // The following routes are potentially public or handled by Clerk:
  // - /sign-in, /sign-up (Clerk default paths)
  // - /login, /register (potential old paths, might need removal later)
  // Matcher avoids running middleware on static files and _next internal paths.
  matcher: ['/((?!.*\..*|_next).*)', '/', '/(api|trpc)(.*)'],
};
