import { json, type LoaderFunctionArgs } from "@remix-run/node";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    await db.bundleItem.deleteMany();
    await db.bundleRule.deleteMany();
    await db.syncLog.deleteMany();
    
    // reset sync count
    await db.shop.updateMany({
      data: { syncCount: 0 }
    });

    return json({ message: "Database completely wiped! (Rules, Items, Logs cleared)" });
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
};
