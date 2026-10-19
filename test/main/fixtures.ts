// Builders shared by the main process's tests.

/**
 * A song in YouTube Music's search results, as the InnerTube API sends it
 * (musicResponsiveListItemRenderer). `columns` are the text runs of each
 * flex column: the title, then the artist, album and duration.
 */
export const songRenderer = ({
  videoId = "dQw4w9WgXcQ",
  columns = [["Song"], ["Artist", " • ", "Album", " • ", "3:25"]],
  thumbnail = "https://lh3.googleusercontent.com/abc=w60-h60-l90-rj",
}: { videoId?: string; columns?: string[][]; thumbnail?: string } = {}) => ({
  overlay: {
    musicItemThumbnailOverlayRenderer: {
      content: {
        musicPlayButtonRenderer: {
          playNavigationEndpoint: { watchEndpoint: { videoId } },
        },
      },
    },
  },
  flexColumns: columns.map((runs) => ({
    musicResponsiveListItemFlexColumnRenderer: {
      text: { runs: runs.map((text) => ({ text })) },
    },
  })),
  thumbnail: {
    musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: thumbnail }] } },
  },
});
