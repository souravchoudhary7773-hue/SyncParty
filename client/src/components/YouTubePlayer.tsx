import React, { useEffect, useRef } from 'react';
import { PlaybackStateDTO, UserRole } from '../types';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

interface YouTubePlayerProps {
  playbackState: PlaybackStateDTO;
  userRole: UserRole;
  onPlay: (currentTime: number) => void;
  onPause: (currentTime: number) => void;
  onSeek: (time: number) => void;
}

export const YouTubePlayer: React.FC<YouTubePlayerProps> = ({
  playbackState,
  userRole,
  onPlay,
  onPause,
  onSeek
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const isReadyRef = useRef<boolean>(false);
  const isUserActionRef = useRef<boolean>(true);

  const canControl = userRole === UserRole.HOST || userRole === UserRole.MODERATOR;

  useEffect(() => {
    let isMounted = true;

    const loadYT = () => {
      if (window.YT && window.YT.Player) {
        initPlayer();
      } else {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

        window.onYouTubeIframeAPIReady = () => {
          if (isMounted) initPlayer();
        };
      }
    };

    const initPlayer = () => {
      if (!containerRef.current || playerRef.current) return;

      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId: playbackState.videoId,
        playerVars: {
          autoplay: 1,
          controls: canControl ? 1 : 0,
          disablekb: canControl ? 0 : 1,
          modestbranding: 1,
          rel: 0,
          enablejsapi: 1,
          origin: window.location.origin
        },
        events: {
          onReady: (event: any) => {
            isReadyRef.current = true;
            // Sync initial state
            syncToPlaybackState(playbackState);
          },
          onStateChange: (event: any) => {
            if (!isUserActionRef.current) {
              isUserActionRef.current = true;
              return;
            }

            if (!canControl) return;

            const player = playerRef.current;
            if (!player) return;
            const currentTime = player.getCurrentTime();

            // YT.PlayerState: PLAYING (1), PAUSED (2), BUFFERING (3), CUED (5)
            if (event.data === window.YT.PlayerState.PLAYING) {
              onPlay(currentTime);
            } else if (event.data === window.YT.PlayerState.PAUSED) {
              onPause(currentTime);
            }
          }
        }
      });
    };

    loadYT();

    return () => {
      isMounted = false;
      if (playerRef.current && playerRef.current.destroy) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, []);

  // Synchronize player with incoming props from WebSocket server
  useEffect(() => {
    if (!isReadyRef.current || !playerRef.current) return;
    syncToPlaybackState(playbackState);
  }, [playbackState]);

  const syncToPlaybackState = (state: PlaybackStateDTO) => {
    const player = playerRef.current;
    if (!player || typeof player.getCurrentTime !== 'function') return;

    const currentVideoId = player.getVideoData()?.video_id;
    if (state.videoId && currentVideoId !== state.videoId) {
      isUserActionRef.current = false;
      player.loadVideoById({ videoId: state.videoId, startSeconds: state.currentTime });
      return;
    }

    const localTime = player.getCurrentTime() || 0;
    const drift = Math.abs(localTime - state.currentTime);

    // If time drift exceeds 1.5 seconds, resync seek position
    if (drift > 1.5) {
      isUserActionRef.current = false;
      player.seekTo(state.currentTime, true);
    }

    // Play/Pause sync
    const playerState = player.getPlayerState();
    if (state.isPlaying && playerState !== window.YT.PlayerState.PLAYING && playerState !== window.YT.PlayerState.BUFFERING) {
      isUserActionRef.current = false;
      player.playVideo();
    } else if (!state.isPlaying && playerState === window.YT.PlayerState.PLAYING) {
      isUserActionRef.current = false;
      player.pauseVideo();
    }
  };

  return (
    <div className="video-wrapper">
      <div ref={containerRef} className="iframe-container" />
      
      {/* Overlay to block direct click events for non-authorized roles */}
      {!canControl && <div className="lockout-overlay" title="Playback controls restricted to Host & Moderator" />}
    </div>
  );
};
