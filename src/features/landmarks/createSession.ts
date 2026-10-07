import { LandmarkSession } from './session';
import { WikimediaSource } from './wikimedia';
export function createWikimediaSession() {
  const source = new WikimediaSource();
  const session = new LandmarkSession('', undefined, source.fetchImage, source.fetchRegion, {clear:source.clear,actualRequests:true});
  source.onRequest = kind => session.noteRequest(kind);
  return session;
}
