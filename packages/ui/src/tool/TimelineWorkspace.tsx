'use client';

import { useRef } from 'react';

import { Timeline, type TimelineRange } from './Timeline';

/** A timeline's several ranges (`preset.ranges`): the list, the selected one, and changes. */
export interface MultiRange {
  ranges: TimelineRange[];
  active: number;
  onChange: (ranges: TimelineRange[], active: number) => void;
}

/**
 * Trim-type tools: the clip on top (following the playhead and handles), the
 * timeline below. Browsers that can't play the codec still show the frames.
 * The ToolShell loads it, with the Timeline, only for a timeline tool.
 */
export function TimelineWorkspace({
  url,
  video,
  durationSec,
  fps,
  thumbs,
  peaks,
  range,
  setRange,
  multiRange,
}: {
  url?: string;
  video: boolean;
  durationSec: number;
  fps?: number;
  thumbs: string[];
  peaks: number[];
  range: TimelineRange;
  setRange: (range: TimelineRange) => void;
  multiRange: MultiRange | null;
}) {
  const player = useRef<HTMLVideoElement>(null);
  const listener = useRef<HTMLAudioElement>(null);
  return (
    <div className="flex flex-col gap-5 px-4 py-6 lg:px-10 lg:pt-8.5">
      {video && url && (
        <video
          ref={player}
          src={url}
          controls
          muted
          playsInline
          preload="metadata"
          aria-label="Your video"
          className="aspect-video max-h-[46dvh] w-full bg-media-scrim object-contain"
        />
      )}
      <Timeline
        durationSec={durationSec}
        fps={fps ? Math.round(fps) : undefined}
        kind={video ? 'video' : 'audio'}
        value={range}
        onChange={setRange}
        {...(multiRange && {
          ranges: multiRange.ranges,
          active: multiRange.active,
          onRangesChange: multiRange.onChange,
        })}
        thumbnails={thumbs}
        peaks={peaks}
        onSeek={(time) => {
          const media = player.current ?? listener.current;
          if (media && media.readyState > 0) media.currentTime = time;
        }}
      />
      {!video && url && (
        <audio
          ref={listener}
          src={url}
          controls
          preload="metadata"
          aria-label="Your audio"
          className="w-full"
        />
      )}
    </div>
  );
}
