import "../../src/config/loadEnv.js";
import connectMongoose from "../../src/db/mongooseConnection.js";
import { mergeSessionVideo } from "../../src/services/capture/sessionVideoMerge.js";

const ids = [
  "6a30cb825c1e8969b7c21117",
  "6a30d47d5c1e8969b7c213e0",
  "6a3182c62356559b0503d335",
  "6a3173ea93dce5be9bd77a4a",
];

async function main() {
  await connectMongoose();
  for (const id of ids) {
    try {
      const r = await mergeSessionVideo(id);
      console.log(`[merge] ${id} ->`, r ? "ok" : "skipped");
    } catch (e: any) {
      console.log(`[merge] ${id} error:`, e?.message || e);
    }
  }
  process.exit(0);
}
main();
