/**
 * A video's decoded frames, read forward in time: the frame on screen at
 * any moment, for redrawing on a new clock (Merge Videos, Change Video
 * Speed). Only the frame showing and the next one are kept open.
 */
import {
  EncodedPacketSink,
  VideoSampleSink,
  type InputVideoTrack,
  type VideoSample,
} from 'mediabunny';

export class Held {
  private iterator: AsyncGenerator<VideoSample> | null;
  private current: VideoSample | null = null;
  private upcoming: VideoSample | null = null;

  constructor(track: InputVideoTrack) {
    this.iterator = new VideoSampleSink(track).samples();
  }

  /** The frame showing at `time` (seconds into the clip); times only go forward. */
  async at(time: number): Promise<VideoSample | null> {
    for (;;) {
      if (!this.upcoming && this.iterator) {
        const next = await this.iterator.next();
        if (next.done) this.iterator = null;
        else this.upcoming = next.value;
      }
      if (!this.upcoming || this.upcoming.timestamp > time + 1e-6) return this.current;
      this.current?.close();
      this.current = this.upcoming;
      this.upcoming = null;
    }
  }

  close(): void {
    this.current?.close();
    this.upcoming?.close();
    void this.iterator?.return(undefined);
  }
}

/**
 * How long a clip's picture shows: to the end of its last frame. Matroska
 * often leaves the last frame's duration out, which would end the clip a
 * frame early and land the next clip on top of that frame.
 */
export async function shownFor(video: InputVideoTrack, fps: number): Promise<number> {
  const end = await video.computeDuration();
  const last = await new EncodedPacketSink(video).getPacket(end);
  if (last && end - last.timestamp < 0.5 / fps) return last.timestamp + 1 / fps;
  return end;
}
