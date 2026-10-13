// An organization's logo: a small image its owners and admins set, shown in
// the sidebar in place of the app's while the organization's workspace is
// active.
//
// Behind the module facade (orgs.service.ts). The image arrives and leaves as
// a data URL. It is stored in org_logos, apart from the organization row, so
// that reading an organization never carries it; organizations.logo_updated_at
// (kept by a database trigger) is what tells a client there is one.

import { recordAudit } from "../../lib/audit";
import { getOrgRole, isOrgAdmin } from "../../lib/access";
import type { OrgResult } from "../../lib/orgs";
import type { Db } from "../../lib/supabase";

/** The most image an organization may store, before base64. */
export const MAX_ORG_LOGO_BYTES = 512 * 1024;

type LogoContentType = "image/png" | "image/jpeg" | "image/webp";

// What each accepted format begins with. The declared type is the client's
// word; these are the file's. SVG is deliberately absent: it is a document
// that can carry script, not a picture.
function hasLogoSignature(contentType: LogoContentType, bytes: Buffer): boolean {
    switch (contentType) {
        case "image/png":
            return bytes.subarray(0, 8).equals(
                Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            );
        case "image/jpeg":
            return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
        case "image/webp":
            return bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
                bytes.subarray(8, 12).toString("latin1") === "WEBP";
    }
}

const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

const UNSUPPORTED = "The logo must be a PNG, JPEG or WebP image.";

/**
 * Check a logo sent as a data URL: a supported type, really an image of that
 * type, and within the size an organization may store. Returns what is kept.
 */
export function parseOrgLogoDataUrl(
    value: unknown,
):
    | { ok: true; contentType: LogoContentType; base64: string }
    | { ok: false; detail: string } {
    if (typeof value !== "string" || !value)
        return { ok: false, detail: "data_url is required" };
    // Refuse an oversized body before running a pattern over it. Base64 is
    // four characters for every three bytes, plus the short prefix.
    if (value.length > Math.ceil(MAX_ORG_LOGO_BYTES / 3) * 4 + 64)
        return { ok: false, detail: "The logo is too large. Use an image under 512 KB." };
    const match = DATA_URL.exec(value);
    if (!match) return { ok: false, detail: UNSUPPORTED };
    const contentType = match[1];
    if (contentType !== "image/png" && contentType !== "image/jpeg" && contentType !== "image/webp")
        return { ok: false, detail: UNSUPPORTED };
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length === 0) return { ok: false, detail: UNSUPPORTED };
    if (bytes.length > MAX_ORG_LOGO_BYTES)
        return { ok: false, detail: "The logo is too large. Use an image under 512 KB." };
    if (!hasLogoSignature(contentType, bytes))
        return { ok: false, detail: UNSUPPORTED };
    // Re-encoded from the decoded bytes, so what is stored is canonical.
    return { ok: true, contentType, base64: bytes.toString("base64") };
}

/** The organization's logo, for any of its members. */
export async function getOrgLogo(
    db: Db,
    params: { userId: string; orgId: string },
): Promise<OrgResult<{ logo: { data_url: string; updated_at: string } }>> {
    const role = await getOrgRole(params.userId, params.orgId, db);
    if (!role) return { ok: false, kind: "not_found" };
    const { data, error } = await db
        .from("org_logos")
        .select("content_type, data_base64, updated_at")
        .eq("org_id", params.orgId)
        .maybeSingle();
    if (error) return { ok: false, kind: "db_error", detail: error.message };
    const row = data as {
        content_type?: string;
        data_base64?: string;
        updated_at?: string;
    } | null;
    if (!row?.content_type || !row.data_base64)
        return { ok: false, kind: "not_found" };
    return {
        ok: true,
        logo: {
            data_url: `data:${row.content_type};base64,${row.data_base64}`,
            updated_at: row.updated_at ?? "",
        },
    };
}

/**
 * Set or replace the organization's logo. Owners and admins only: it is how
 * the organization presents itself to every member.
 */
export async function saveOrgLogo(
    db: Db,
    params: {
        actorId: string;
        actorEmail?: string | null;
        orgId: string;
        dataUrl: unknown;
    },
): Promise<OrgResult<{ logo_updated_at: string }>> {
    const role = await getOrgRole(params.actorId, params.orgId, db);
    if (!role) return { ok: false, kind: "not_found" };
    if (!isOrgAdmin(role)) return { ok: false, kind: "forbidden" };

    const parsed = parseOrgLogoDataUrl(params.dataUrl);
    if (!parsed.ok)
        return { ok: false, kind: "validation", detail: parsed.detail };

    const updatedAt = new Date().toISOString();
    const { error } = await db.from("org_logos").upsert(
        {
            org_id: params.orgId,
            content_type: parsed.contentType,
            data_base64: parsed.base64,
            updated_by: params.actorId,
            updated_at: updatedAt,
        },
        { onConflict: "org_id" },
    );
    if (error) return { ok: false, kind: "db_error", detail: error.message };

    await recordAudit(db, {
        userId: params.actorId,
        userEmail: params.actorEmail ?? null,
        action: "org.logo.updated",
        // Never the image itself.
        detail: { org_id: params.orgId, content_type: parsed.contentType },
    });
    return { ok: true, logo_updated_at: updatedAt };
}

/** Remove the organization's logo; the app's own is shown again. */
export async function removeOrgLogo(
    db: Db,
    params: { actorId: string; actorEmail?: string | null; orgId: string },
): Promise<OrgResult<{ logo_updated_at: null }>> {
    const role = await getOrgRole(params.actorId, params.orgId, db);
    if (!role) return { ok: false, kind: "not_found" };
    if (!isOrgAdmin(role)) return { ok: false, kind: "forbidden" };

    const { data, error } = await db
        .from("org_logos")
        .delete()
        .eq("org_id", params.orgId)
        .select("org_id");
    if (error) return { ok: false, kind: "db_error", detail: error.message };
    // Removing a logo that is not there is not worth an audit line.
    if (((data ?? []) as unknown[]).length > 0)
        await recordAudit(db, {
            userId: params.actorId,
            userEmail: params.actorEmail ?? null,
            action: "org.logo.removed",
            detail: { org_id: params.orgId },
        });
    return { ok: true, logo_updated_at: null };
}
