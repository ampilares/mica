use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

/// Current time as RFC 3339 with local offset where available
/// (e.g. `2026-07-07T09:30:00+10:00`), falling back to UTC.
pub fn now_rfc3339() -> String {
    let now = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());
    // Drop sub-second precision for stable, readable files.
    let now = now.replace_nanosecond(0).unwrap_or(now);
    now.format(&Rfc3339)
        .unwrap_or_else(|_| String::from("1970-01-01T00:00:00Z"))
}
