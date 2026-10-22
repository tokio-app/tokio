export type SongInfo = {
  // Spotify: the album uri, or in playerStatus the playing context ("" if none)
  album: string;
  track: string;
  title: string;
  thumbnail: string;
  duration: number;
};

export type CurrentSongInfo = {
  time: number;
  playing: boolean;
} & SongInfo;
