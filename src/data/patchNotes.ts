/** Newest first. A release page can be updated without changing its navigation. */
export const patchNotes = [
  { version: '3.0', preview: true, sections: [['launch.latest', 'launch.latestBody'], ['launch.shareNews', 'launch.shareBody']] },
  { version: '2.0.1', sections: [['launch.previousTitle', 'launch.previousBody']] },
] as const;
