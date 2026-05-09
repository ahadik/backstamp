use rusqlite::{Connection, params};

// ── Data ──────────────────────────────────────────────────────────────────────

const FILM_VENDORS: &[&str] = &[
    "Adox",
    "AgfaPhoto",
    "Bergger",
    "CineStill",
    "Dubblefilm",
    "Film Ferrania",
    "Film Washi",
    "Foma",
    "Fujifilm",
    "Harman",
    "Ilford",
    "JCH",
    "Kodak",
    "Konica",
    "Kosmo Foto",
    "Lomography",
    "Rollei",
    "Silberra",
    "Svema",
];

/// (vendor, type_name)
const FILM_TYPES: &[(&str, &str)] = &[
    // ── Adox ─────────────────────────────────────────────────────────────────
    ("Adox", "CHS 100 II"),
    ("Adox", "CMS 20 II Pro"),
    ("Adox", "Color Mission 200"),
    ("Adox", "HR-50"),
    ("Adox", "Scala 160"),
    ("Adox", "Silvermax 100"),

    // ── AgfaPhoto ─────────────────────────────────────────────────────────────
    ("AgfaPhoto", "APX 100"),
    ("AgfaPhoto", "APX 400"),

    // ── Bergger ───────────────────────────────────────────────────────────────
    ("Bergger", "Pancro 400"),

    // ── CineStill ─────────────────────────────────────────────────────────────
    ("CineStill", "50D"),
    ("CineStill", "400D"),
    ("CineStill", "800T"),
    ("CineStill", "BwXX"),

    // ── Dubblefilm ────────────────────────────────────────────────────────────
    ("Dubblefilm", "Bubblegum 200"),
    ("Dubblefilm", "Monsoon 200"),
    ("Dubblefilm", "Moonstruck 200"),
    ("Dubblefilm", "Show 200"),
    ("Dubblefilm", "Sunstroke 200"),

    // ── Film Ferrania ─────────────────────────────────────────────────────────
    ("Film Ferrania", "Orto 50"),
    ("Film Ferrania", "P30 Alpha"),
    ("Film Ferrania", "P33"),

    // ── Film Washi ───────────────────────────────────────────────────────────
    ("Film Washi", "A 12"),
    ("Film Washi", "D 500"),
    ("Film Washi", "S 50"),
    ("Film Washi", "V 100"),
    ("Film Washi", "W 25"),
    ("Film Washi", "Z 400"),

    // ── Foma ─────────────────────────────────────────────────────────────────
    ("Foma", "Fomapan 100 Classic"),
    ("Foma", "Fomapan 200 Creative"),
    ("Foma", "Fomapan 400 Action"),
    ("Foma", "Fomapan R 100"),
    ("Foma", "Retropan 320 Soft"),

    // ── Fujifilm ─────────────────────────────────────────────────────────────
    // Current
    ("Fujifilm", "C200"),
    ("Fujifilm", "Fujicolor 200"),
    ("Fujifilm", "Neopan 100 Acros II"),
    ("Fujifilm", "Provia 100F"),
    ("Fujifilm", "Superia X-TRA 400"),
    ("Fujifilm", "Velvia 50"),
    ("Fujifilm", "Velvia 100"),
    // Discontinued
    ("Fujifilm", "Astia 100F"),
    ("Fujifilm", "Neopan 1600"),
    ("Fujifilm", "Pro 160NS"),
    ("Fujifilm", "Pro 400H"),
    ("Fujifilm", "Provia 400X"),
    ("Fujifilm", "Reala 100"),
    ("Fujifilm", "Sensia 100"),
    ("Fujifilm", "Superia 100"),
    ("Fujifilm", "Superia 200"),
    ("Fujifilm", "Superia 400"),
    ("Fujifilm", "Superia 800"),
    ("Fujifilm", "Superia 1600"),

    // ── Harman ───────────────────────────────────────────────────────────────
    ("Harman", "Phoenix 200"),

    // ── Ilford ───────────────────────────────────────────────────────────────
    ("Ilford", "Delta 100"),
    ("Ilford", "Delta 400"),
    ("Ilford", "Delta 3200"),
    ("Ilford", "FP4 Plus 125"),
    ("Ilford", "HP5 Plus 400"),
    ("Ilford", "Kentmere 100"),
    ("Ilford", "Kentmere 400"),
    ("Ilford", "Ortho Plus 80"),
    ("Ilford", "Pan F Plus 50"),
    ("Ilford", "SFX 200"),
    ("Ilford", "XP2 Super 400"),

    // ── JCH ──────────────────────────────────────────────────────────────────
    ("JCH", "Street Pan 400"),

    // ── Kodak ────────────────────────────────────────────────────────────────
    // Current
    ("Kodak", "ColorPlus 200"),
    ("Kodak", "Ektachrome E100"),
    ("Kodak", "Ektar 100"),
    ("Kodak", "Gold 200"),
    ("Kodak", "Kodacolor 200"),
    ("Kodak", "Pro Image 100"),
    ("Kodak", "Portra 160"),
    ("Kodak", "Portra 400"),
    ("Kodak", "Portra 800"),
    ("Kodak", "T-Max 100"),
    ("Kodak", "T-Max 400"),
    ("Kodak", "T-Max P3200"),
    ("Kodak", "Tri-X 400"),
    ("Kodak", "UltraMax 400"),
    // Discontinued
    ("Kodak", "Ektachrome 100VS"),
    ("Kodak", "Ektachrome 200"),
    ("Kodak", "Kodachrome 25"),
    ("Kodak", "Kodachrome 64"),
    ("Kodak", "Kodachrome 200"),
    ("Kodak", "Plus-X 125"),
    ("Kodak", "Portra 160NC"),
    ("Kodak", "Portra 160VC"),
    ("Kodak", "Portra 400NC"),
    ("Kodak", "Portra 400VC"),
    ("Kodak", "Royal Gold 100"),
    ("Kodak", "Royal Gold 200"),
    ("Kodak", "Royal Gold 400"),

    // ── Konica ────────────────────────────────────────────────────────────────
    ("Konica", "Centuria 100"),
    ("Konica", "Centuria 200"),
    ("Konica", "Centuria 400"),
    ("Konica", "Centuria 800"),
    ("Konica", "Centuria 1600"),
    ("Konica", "Monochrome VX 400"),

    // ── Kosmo Foto ────────────────────────────────────────────────────────────
    ("Kosmo Foto", "Mono 100"),

    // ── Lomography ────────────────────────────────────────────────────────────
    ("Lomography", "Berlin Kino 400"),
    ("Lomography", "Color Negative 100"),
    ("Lomography", "Color Negative 400"),
    ("Lomography", "Color Negative 800"),
    ("Lomography", "Earl Grey 100"),
    ("Lomography", "Lady Grey 400"),
    ("Lomography", "LomoChrome Color '92 400"),
    ("Lomography", "LomoChrome Metropolis"),
    ("Lomography", "LomoChrome Purple"),
    ("Lomography", "LomoChrome Turquoise"),
    ("Lomography", "Orca 100"),
    ("Lomography", "Potsdam Kino 100"),
    ("Lomography", "Redscale XR 50-200"),

    // ── Rollei ───────────────────────────────────────────────────────────────
    ("Rollei", "CN 200"),
    ("Rollei", "Infrared 400"),
    ("Rollei", "Ortho 25 Plus"),
    ("Rollei", "Retro 80S"),
    ("Rollei", "Retro 400S"),
    ("Rollei", "RPX 25"),
    ("Rollei", "RPX 100"),
    ("Rollei", "RPX 400"),
    ("Rollei", "Superpan 200"),

    // ── Silberra ─────────────────────────────────────────────────────────────
    ("Silberra", "Pan 100"),
    ("Silberra", "Pan 160"),
    ("Silberra", "Pan 200"),
    ("Silberra", "U200"),
    ("Silberra", "U400"),

    // ── Svema ────────────────────────────────────────────────────────────────
    ("Svema", "Foto 100"),
    ("Svema", "Foto 200"),
    ("Svema", "Foto 400"),
];

// ── Public API ────────────────────────────────────────────────────────────────

pub fn seed_film_corpus(conn: &Connection) -> rusqlite::Result<()> {
    for vendor in FILM_VENDORS {
        conn.execute(
            "INSERT OR IGNORE INTO corpus (category, value, is_builtin, use_count)
             VALUES ('film_vendor', ?1, 1, 0)",
            params![vendor],
        )?;
    }

    for (vendor, film_type) in FILM_TYPES {
        conn.execute(
            "INSERT OR IGNORE INTO corpus (category, value, is_builtin, use_count, vendor)
             VALUES ('film_type', ?1, 1, 0, ?2)",
            params![film_type, vendor],
        )?;
    }

    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn in_memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE corpus (
                category   TEXT NOT NULL,
                value      TEXT NOT NULL,
                is_builtin INTEGER NOT NULL DEFAULT 0,
                last_used  INTEGER,
                use_count  INTEGER NOT NULL DEFAULT 0,
                vendor     TEXT,
                PRIMARY KEY (category, value)
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn seeds_all_vendors() {
        let conn = in_memory_db();
        seed_film_corpus(&conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM corpus WHERE category = 'film_vendor'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count as usize, FILM_VENDORS.len());
    }

    #[test]
    fn seeds_all_types() {
        let conn = in_memory_db();
        seed_film_corpus(&conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM corpus WHERE category = 'film_type'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count as usize, FILM_TYPES.len());
    }

    #[test]
    fn all_types_have_vendor_set() {
        let conn = in_memory_db();
        seed_film_corpus(&conn).unwrap();
        let orphans: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM corpus WHERE category = 'film_type' AND vendor IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(orphans, 0);
    }

    #[test]
    fn all_type_vendors_exist_in_vendor_list() {
        let conn = in_memory_db();
        seed_film_corpus(&conn).unwrap();
        let missing: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM corpus t
                 WHERE t.category = 'film_type'
                 AND NOT EXISTS (
                     SELECT 1 FROM corpus v
                     WHERE v.category = 'film_vendor' AND v.value = t.vendor
                 )",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(missing, 0, "some film types reference a vendor not in FILM_VENDORS");
    }

    #[test]
    fn seed_is_idempotent() {
        let conn = in_memory_db();
        seed_film_corpus(&conn).unwrap();
        seed_film_corpus(&conn).unwrap();
        let vendor_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM corpus WHERE category = 'film_vendor'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(vendor_count as usize, FILM_VENDORS.len());
    }

    #[test]
    fn all_vendors_are_marked_builtin() {
        let conn = in_memory_db();
        seed_film_corpus(&conn).unwrap();
        let non_builtin: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM corpus WHERE category = 'film_vendor' AND is_builtin = 0",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(non_builtin, 0);
    }

    #[test]
    fn all_types_are_marked_builtin() {
        let conn = in_memory_db();
        seed_film_corpus(&conn).unwrap();
        let non_builtin: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM corpus WHERE category = 'film_type' AND is_builtin = 0",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(non_builtin, 0);
    }
}
