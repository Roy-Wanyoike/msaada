import { type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";

/**
 * Next.js 16 network-boundary file. (Next 15 and earlier named this
 * middleware.ts with a `middleware` export; from Next 16 the supported name
 * is proxy.ts with a `proxy` export — verified against next@16.1.3's
 * PROXY_FILENAME constant.)
 *
 * Refreshes Supabase auth cookies before they hit a route handler or Server
 * Component. Strict pass-through when Supabase isn't configured, so local
 * dev and the Vercel demo are unaffected until env vars are set.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (build assets)
     * - image/audio files with a static extension (safe to skip auth refresh)
     * - favicon.ico, sitemap/robots
     * Feel free to remove this if you want the session refresh on everything.
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp3|wav|ogg|webm|m4a|aac)$).*)",
  ],
};
