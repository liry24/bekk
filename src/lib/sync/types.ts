import type { ConfigStore } from '../../store'
import type { ScoopApp, WingetApp } from '../apps'

// ─── S3 Destination ───────────────────────────────────────────────────────────

export interface S3Destination {
    /** User-defined name (e.g. "work-r2", "home-s3"). Used as credential key. */
    name: string
    bucket: string
    region: string
    /** Optional custom endpoint URL for R2/MinIO/etc. Empty string = AWS standard. */
    endpoint: string
    accessKeyId: string
}

// ─── Sync Data ────────────────────────────────────────────────────────────────

export interface SyncData {
    config: ConfigStore
    appLists: {
        scoop: ScoopApp[] | null
        winget: WingetApp[]
    }
}

// ─── Backend Interface ────────────────────────────────────────────────────────

export interface SyncBackend {
    /** Human-readable identifier shown in output (e.g. "gist", "work-r2"). */
    readonly label: string

    /** Upload SyncData. Returns a URL or path string for display. */
    push(data: SyncData): Promise<string>

    /**
     * Download SyncData.
     * @param identifier Optional override (e.g. gist URL, S3 object key).
     *   When omitted the backend uses its last-known reference.
     */
    pull(identifier?: string): Promise<SyncData>
}
