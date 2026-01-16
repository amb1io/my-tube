import { column, defineDb } from 'astro:db';

// https://astro.build/db/config
export default defineDb({
  tables: {
    youtube_tokens: {
      columns: {
        id: column.text({ primaryKey: true }),
        access_token: column.text(),
        refresh_token: column.text({ optional: true }),
        scope: column.text({ optional: true }),
        expires_at: column.date({ optional: true }),
        created_at: column.date()
      }
    },
    watch_later_videos: {
      columns: {
        video_id: column.text({ primaryKey: true }),
        title: column.text({ optional: true }),
        channel: column.text({ optional: true }),
        thumbnail: column.text({ optional: true }),
        duration: column.text({ optional: true }),
        position: column.number({ optional: true }),
        synced_at: column.date({ optional: true }),
        payload: column.text({ optional: true })
      }
    }
  }
});
