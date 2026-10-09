import { buildIcs } from "@/lib/ics";
import { calendarItem } from "../data";

// The .ics file for one booking. Open like /upload links: the id is random and unguessable.
export async function GET(_request: Request, ctx: RouteContext<"/c/[id]/ics">) {
  const { id } = await ctx.params;
  const item = await calendarItem(id);
  if (!item) return new Response("Not found", { status: 404 });
  return new Response(buildIcs([item]), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="demo-${item.ref}.ics"`,
      "cache-control": "no-store",
    },
  });
}
