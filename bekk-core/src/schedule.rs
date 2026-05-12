use anyhow::{Result, anyhow};
use chrono::{Datelike, Local, NaiveTime, Weekday};
use serde_json::{Value, json};

use crate::response::ok_data;

pub fn parse_time(s: &str) -> Result<NaiveTime> {
    NaiveTime::parse_from_str(s, "%H:%M")
        .map_err(|_| anyhow!("Invalid time format: {}. Expected HH:MM", s))
}

pub fn parse_dow(s: &str) -> Result<Weekday> {
    match s.to_ascii_lowercase().as_str() {
        "mon" | "monday" => Ok(Weekday::Mon),
        "tue" | "tuesday" => Ok(Weekday::Tue),
        "wed" | "wednesday" => Ok(Weekday::Wed),
        "thu" | "thursday" => Ok(Weekday::Thu),
        "fri" | "friday" => Ok(Weekday::Fri),
        "sat" | "saturday" => Ok(Weekday::Sat),
        "sun" | "sunday" => Ok(Weekday::Sun),
        _ => Err(anyhow!("Invalid day of week: {}", s)),
    }
}

pub fn next_daily(now: chrono::DateTime<Local>, time: NaiveTime) -> Result<chrono::DateTime<Local>> {
    let candidate = now
        .date_naive()
        .and_time(time)
        .and_local_timezone(now.timezone())
        .single()
        .ok_or_else(|| anyhow!("Invalid local time"))?;
    if candidate > now {
        Ok(candidate)
    } else {
        Ok(candidate + chrono::Duration::days(1))
    }
}

pub fn next_weekly(
    now: chrono::DateTime<Local>,
    dow: Weekday,
    time: NaiveTime,
) -> Result<chrono::DateTime<Local>> {
    let today_dow = now.weekday();
    let current_num = today_dow.number_from_monday() as i32;
    let target_num = dow.number_from_monday() as i32;
    let mut days_ahead = (target_num - current_num + 7) % 7;

    let candidate = now
        .date_naive()
        .and_time(time)
        .and_local_timezone(now.timezone())
        .single()
        .ok_or_else(|| anyhow!("Invalid local time"))?;

    if days_ahead == 0 {
        if candidate > now {
            return Ok(candidate);
        }
        days_ahead = 7;
    }

    let next_date = now + chrono::Duration::days(days_ahead as i64);
    next_date
        .date_naive()
        .and_time(time)
        .and_local_timezone(now.timezone())
        .single()
        .ok_or_else(|| anyhow!("Invalid local time"))
}

pub fn next_monthly(
    now: chrono::DateTime<Local>,
    day: u32,
    time: NaiveTime,
) -> Result<chrono::DateTime<Local>> {
    let candidate_date = now
        .date_naive()
        .with_day(day)
        .ok_or_else(|| anyhow!("Invalid day {} for current month", day))?;
    let candidate = candidate_date
        .and_time(time)
        .and_local_timezone(now.timezone())
        .single()
        .ok_or_else(|| anyhow!("Invalid local time"))?;

    if candidate > now {
        return Ok(candidate);
    }

    let next_year = if now.month() == 12 {
        now.year() + 1
    } else {
        now.year()
    };
    let next_month = if now.month() == 12 { 1 } else { now.month() + 1 };
    let next_date =
        chrono::NaiveDate::from_ymd_opt(next_year, next_month, day)
            .ok_or_else(|| anyhow!("Invalid day {} for next month", day))?;

    next_date
        .and_time(time)
        .and_local_timezone(now.timezone())
        .single()
        .ok_or_else(|| anyhow!("Invalid local time"))
}

pub fn next_interval(
    now: chrono::DateTime<Local>,
    minutes: u32,
) -> Result<chrono::DateTime<Local>> {
    Ok(now + chrono::Duration::minutes(minutes as i64))
}

pub fn cmd_schedule_info(
    daily: Option<String>,
    weekly: Vec<String>,
    monthly: Vec<String>,
    interval: Option<u32>,
) -> Result<Value> {
    let now = Local::now();
    let next = if let Some(t) = daily {
        let time = parse_time(&t)?;
        next_daily(now, time)?
    } else if weekly.len() == 2 {
        let dow = parse_dow(&weekly[0])?;
        let time = parse_time(&weekly[1])?;
        next_weekly(now, dow, time)?
    } else if monthly.len() == 2 {
        let day: u32 = monthly[0]
            .parse()
            .map_err(|_| anyhow!("Invalid day: {}", monthly[0]))?;
        let time = parse_time(&monthly[1])?;
        next_monthly(now, day, time)?
    } else if let Some(mins) = interval {
        next_interval(now, mins)?
    } else {
        return Err(anyhow!(
            "No schedule specified. Use --daily, --weekly, --monthly, or --interval"
        ));
    };

    Ok(ok_data(json!({
        "next_run": next.to_rfc3339(),
    })))
}
