import { util } from 'peerjs';

/** Dev/test helper (npm run coop): the bytes a message takes on the wire (PeerJS binarypack). */
export function wireBytes(v: unknown): number {
  return (util.pack(v as Parameters<typeof util.pack>[0]) as ArrayBuffer).byteLength;
}
