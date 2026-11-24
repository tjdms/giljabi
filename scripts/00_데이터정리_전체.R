# =========================================================
# 길잡이들 데이터 정리 (전체 한 번에)
# raw 폴더 원본 → clean 폴더 공통 형식 CSV
# 공통 컬럼: id, type, name, lat, lon, count, base_date, source, note
# =========================================================

# install.packages(c("readr", "dplyr"))   # 처음 한 번만
library(readr)
library(dplyr)

BASE <- "~/Google Drive/길잡이들"   # ← 각자 길잡이들 폴더 경로로 바꾸기
RAW   <- file.path(BASE, "raw")
CLEAN <- file.path(BASE, "clean")
dir.create(CLEAN, showWarnings = FALSE)

# 한글 깨짐 방지: UTF-8이 아니면 CP949로 읽기
read_kr <- function(file) {
  path <- file.path(RAW, file)
  is_utf8 <- all(validUTF8(readLines(path, n = 20, warn = FALSE)))
  read_csv(path, locale = locale(encoding = if (is_utf8) "UTF-8" else "CP949"),
           show_col_types = FALSE, guess_max = 100000)
}

# 공통 정리: 좌표 확인 → 같은 좌표 합치기(count 합산) → id 부여 → 저장
finish <- function(df, type, out_file) {
  n0 <- nrow(df)
  df <- df %>%
    mutate(lat = suppressWarnings(as.numeric(lat)), lon = suppressWarnings(as.numeric(lon))) %>%
    filter(!is.na(lat), !is.na(lon),
           between(lat, 34.8, 35.5), between(lon, 128.7, 129.4)) %>%      # 부산 범위
    group_by(lat, lon) %>%
    summarise(name = first(name), count = sum(count), base_date = max(base_date),
              source = first(source), note = paste(unique(note[note != ""]), collapse = "/"),
              .groups = "drop") %>%
    mutate(type = type, id = sprintf("%s_%04d", type, row_number() - 1)) %>%
    select(id, type, name, lat, lon, count, base_date, source, note)
  write_excel_csv(df, file.path(CLEAN, out_file))
  cat(sprintf("[%s] 남구 %d건 → %d지점 (count 합계 %d) → %s\n",
              type, n0, nrow(df), as.integer(sum(df$count)), out_file))
  invisible(df)
}

# 1) CCTV ----------------------------------------------------
cctv <- read_kr("CCTV정보_부산광역시.csv") %>%
  filter(grepl("남구", 관리기관명)) %>%
  transmute(name = coalesce(소재지도로명주소, 소재지지번주소),
            lat = WGS84위도, lon = WGS84경도,
            count = as.numeric(카메라대수), base_date = as.character(데이터기준일자),
            source = "공공데이터포털", note = 설치목적구분)
cctv$name[cctv$name %in% c("부산광역시", "부산광역시 -", "-")] <- ""
finish(cctv, "cctv", "cctv_namgu.csv")

# 2) 안전비상벨 ------------------------------------------------
bell <- read_kr("안전비상벨위치정보_부산광역시.csv") %>%
  filter(grepl("남구", 관리기관명)) %>%
  transmute(name = coalesce(설치위치, 소재지도로명주소),
            lat = WGS84위도, lon = WGS84경도, count = 1,
            base_date = as.character(데이터기준일자), source = "공공데이터포털", note = "")
finish(bell, "bell", "bell_namgu.csv")

# 3) 상가 (점수용: 전체 / 지도 표시용: 편의점) -------------------
shop_raw <- read_kr("소상공인시장진흥공단_상가(상권)정보_부산_202609.csv") %>%
  filter(시군구명 == "남구")
shop <- shop_raw %>%
  transmute(name = 상호명, lat = 위도, lon = 경도, count = 1,
            base_date = "2026-09", source = "소상공인시장진흥공단", note = 상권업종대분류명)
finish(shop, "shop", "shop_namgu.csv")

store <- shop_raw %>%
  filter(상권업종소분류명 == "편의점") %>%
  transmute(name = paste(상호명, coalesce(지점명, "")), lat = 위도, lon = 경도, count = 1,
            base_date = "2026-09", source = "소상공인시장진흥공단", note = "24시간 여부 미확인")
finish(store, "store", "store_namgu.csv")

# 4) 구청 안심귀갓길 시설 (비교·검증용) --------------------------
safe <- read_kr("부산광역시 남구_안심귀갓길 설치 현황_20250625.csv") %>%
  transmute(name = 위치, lat = 위도, lon = 경도, count = 1,
            base_date = "2025-06-25", source = "공공데이터포털", note = 구분)
finish(safe, "safe_road", "safe_road_namgu.csv")

# 5) 지구대·파출소 (주소만 있음 → 좌표는 따로 채워야 함) ---------
police <- read_kr("경찰청_전국 지구대 파출소 주소 현황_20251231.csv") %>%
  filter(grepl("부산광역시 남구", gsub("\\s+", " ", 주소))) %>%
  transmute(name = paste(관서명, 구분), address = gsub("\\s+", " ", 주소),
            lat = NA_real_, lon = NA_real_)
write_excel_csv(police, file.path(CLEAN, "police_namgu_주소.csv"))
cat(sprintf("[police] 남구 %d곳 → 좌표 비어 있음, police_namgu_주소.csv 에 위도·경도 채우기\n", nrow(police)))
