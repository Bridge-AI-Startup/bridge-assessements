import "../../src/config/loadEnv.js";
import connectMongoose from "../../src/db/mongooseConnection.js";
import ProctoringSessionModel from "../../src/models/proctoringSession.js";
import { getFrameStorage } from "../../src/services/capture/storage.js";

const ids = [
  "6a30cb825c1e8969b7c21117",
  "6a30d47d5c1e8969b7c213e0",
  "6a3182c62356559b0503d335",
  "6a3173ea93dce5be9bd77a4a",
];

async function main() {
  await connectMongoose();
  const storage = getFrameStorage();
  for (const id of ids) {
    const s = await ProctoringSessionModel.findById(id).lean();
    const key = `${id}/playback.webm`;
    let playbackBytes = 0;
    try {
      playbackBytes = (await storage.getVideoChunk(key)).length;
    } catch {
      /* */
    }
    console.log(JSON.stringify({
      id,
      status: s?.status,
      mergedVideo: s?.mergedVideo,
      videoChunks: s?.videoChunks?.length ?? 0,
      s3PlaybackBytes: playbackBytes,
      transcriptStatus: s?.transcript?.status,
      refinedStatus: s?.transcript?.refinedStatus,
      refinedKey: s?.transcript?.refinedStorageKey,
    }));
  }
  process.exit(0);
}
main();
