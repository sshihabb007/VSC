window.addEventListener(
  'message',
  (event) => {
    if (
      event.origin !== 'https://www.netflix.com' ||
      event.data?.action !== 'videospeed-seek' ||
      !event.data.seekMs
    ) {
      return;
    }
    try {
      const videoPlayer = window.netflix?.appContext?.state?.playerApp?.getAPI()?.videoPlayer;
      if (!videoPlayer) return;
      const sessionId = videoPlayer.getAllPlayerSessionIds()?.[0];
      if (!sessionId) return;
      const currentTime = videoPlayer.getCurrentTimeBySessionId(sessionId);
      videoPlayer.getVideoPlayerBySessionId(sessionId)?.seek(currentTime + event.data.seekMs);
    } catch {
      // Ignore transient player unavailability
    }
  },
  false
);

