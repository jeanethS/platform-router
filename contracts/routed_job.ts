export type Platform =
  | "instagram"
  | "linkedin"
  | "youtube"
  | "x"
  | "tiktok"
  | "douyin"
  | "rednote"
  | "whatsapp"
  | "whatsapp_status";

export type ContentFormat =
  | "carousel"
  | "short_video"
  | "long_video"
  | "thread"
  | "note"
  | "audio_note"
  | "broadcast"
  | "voice_memo";

export interface RoutedJob {
  id: string;
  cluster_report: import("./cluster_report").ClusterReport;
  target_platform: Platform;
  content_format: ContentFormat;
  priority: number;
  created_at: string;
}
