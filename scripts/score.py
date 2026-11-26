"""길잡이들 안전점수 계산 (scripts/길잡이들_안전점수_계산.ipynb를 로컬 실행용으로 옮김)

계산 방식은 노트북과 같다. 바뀐 점:
- 경로: 구글 드라이브 대신 저장소 기준 data/clean/ 읽고 public/data/에 저장
- 노트북의 지도 확인(folium)·경로 비교 셀은 확인용이라 뺌
- 출력 속성은 CLAUDE.md 기준 (u, v, length, safety, score, grade, cost)
- facilities.geojson (cctv, bell, police, store) 추가 출력

실행: python scripts/score.py   (인터넷 필요: OSM 도로망·장소 검색)
"""
import json
import os
from pathlib import Path

import geopandas as gpd
import networkx as nx
import numpy as np
import osmnx as ox
import pandas as pd
from shapely.geometry import Point

ROOT = Path(__file__).resolve().parent.parent
CLEAN = ROOT / "data" / "clean"
OUT = ROOT / "public" / "data"

# ── 설정 (노트북 ②) ──────────────────────────────────────────
# 분석 범위: 아래 장소들 중심으로 반경 RADIUS_M 안
CENTERS = {                       # 이름: (위도, 경도) — None이면 이름으로 자동 검색
    "경성대학교": None,
    "부경대학교 대연캠퍼스": None,
    "경성대·부경대역": (35.137539, 129.100524),   # 이름 검색 실패 → OSM 역 노드 14102501758 좌표
    "대연역": (35.135132, 129.092166),            # 이름 검색 실패 → OSM 역 노드 14102501757 좌표
}
RADIUS_M = 1200

# 지표 설정: 파일, 논문 가중치, 시설 탐색 반경(m), 방향
INDICATORS = {
    "light": {"file": "light_namgu.csv", "w": 0.207, "radius": 25, "higher_is_safer": True},
    "cctv":  {"file": "cctv_namgu.csv",  "w": 0.178, "radius": 50, "higher_is_safer": True},
    "shop":  {"file": "shop_namgu.csv",  "w": 0.084, "radius": 50, "higher_is_safer": True},
    "slope": {"file": "dem_namgu.tif",   "w": 0.031, "radius": None, "higher_is_safer": False},
}

MIN_LEN = 20      # 너무 짧은 구간은 밀도가 튀어서 최소 길이 20m로 계산
CLIP_Q  = 0.95    # 정규화할 때 상위 5% 극단값은 잘라서 계산
CRS_M   = "EPSG:5179"   # 거리 계산용 좌표계 (미터 단위)

FACILITY_TYPES = ["cctv", "bell", "police", "store"]   # 지도에 띄울 시설

# 인도·횡단보도는 바로 옆 차도와 같은 길이라 차도의 시설 밀도를 같이 씀
# (보안등 데이터에 큰길 가로등이 없어 인도만 따로 보면 시설 0으로 나오는 문제 보완)
SHARE_FOOTWAY = {"sidewalk", "crossing"}          # OSM footway=*
ROAD_TYPES = {"trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
              "tertiary", "tertiary_link", "residential", "unclassified", "living_street"}
SHARE_MAX_DIST = 30   # 인도 중간점에서 이 거리 안의 가장 가까운 차도와 짝지음 (m)
# 큰길: 보안등 데이터에 큰길 가로등이 없어 점수가 낮게 나옴 → 큰길과 그 옆에 짝지어진 인도·횡단보도는
# streetlight_missing=true (사각지대 정책 순위에서 빼고 "가로등 미반영"으로 표시)
BIG_ROADS = {"trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
             "tertiary", "tertiary_link"}
ox.settings.useful_tags_way = list(dict.fromkeys(list(ox.settings.useful_tags_way) + ["footway", "foot"]))

# 보행망에서 뺄 길 (밤에 사람이 실제로 걸을 수 없는 길이 지름길로 쓰이지 않게)
EXCLUDE_SERVICE = {"driving_learning"}   # 운전면허시험장 코스
NO_ACCESS = {"private", "no"}            # 출입 금지 (단 foot이 FOOT_OK면 유지)
FOOT_OK = {"yes", "designated"}
EXCLUDE_LANDUSE = {"landuse": "cemetery"}   # 묘역 안 길
# 이용 시간(opening_hours)이 정해진(24/7 아님) 구역 안 길: 밤에 닫힘. UN기념공원은 OSM에서 묘역이 아니라
# leisure=park + opening_hours(9~17/18시)로 그려져 있어서 이 기준으로 빠짐

# 범례에 기준일을 보여줄 데이터 (meta.json)
META_DATASETS = {
    "light": "보안등", "cctv": "CCTV", "shop": "상가",
    "bell": "비상벨", "police": "지구대", "store": "편의점",
}


# ── 분석 범위 + 보행 도로망 (노트북 ③) ────────────────────────
def load_network():
    pts = []
    for name, xy in CENTERS.items():
        if xy is None:
            try:
                xy = ox.geocode(name + ", 부산")
            except Exception:
                raise ValueError(f"'{name}' 위치를 못 찾음 → CENTERS에 (위도, 경도) 직접 넣어줘")
        print(f"{name}: {xy}")
        pts.append(Point(xy[1], xy[0]))

    area = (gpd.GeoSeries(pts, crs="EPSG:4326").to_crs(CRS_M)
              .buffer(RADIUS_M).union_all())
    area_gdf = gpd.GeoDataFrame(geometry=[area], crs=CRS_M)
    polygon = area_gdf.to_crs("EPSG:4326").geometry.iloc[0]

    G  = ox.graph_from_polygon(polygon, network_type="walk")
    Gp = ox.project_graph(G, to_crs=CRS_M)
    nodes, edges = ox.graph_to_gdfs(Gp)
    print("도로 구간 수:", len(edges), "/ 교차점 수:", len(nodes))
    return Gp, nodes, edges, polygon


# ── 시설 지표 (노트북 ④) ─────────────────────────────────────
def facility_density(edges, key, cfg):
    path = CLEAN / cfg["file"]
    if not path.exists():
        print(f"[{key}] 파일 없음 → 건너뜀 ({cfg['file']})")
        return None
    df = pd.read_csv(path)
    p = gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df["lon"], df["lat"]), crs="EPSG:4326").to_crs(CRS_M)
    buf = gpd.GeoDataFrame(geometry=edges.geometry.buffer(cfg["radius"]), crs=CRS_M)
    hit = gpd.sjoin(p[["count", "geometry"]], buf, predicate="within")
    total = hit.groupby(["u", "v", "key"])["count"].sum()
    total = total.reindex(edges.index, fill_value=0)
    length = edges["length"].clip(lower=MIN_LEN)
    print(f"[{key}] 시설 {len(p)}개 사용, 시설 있는 구간 비율 {(total > 0).mean():.0%}")
    return total / length * 100


def first_tag(v):
    # 여러 OSM 길이 합쳐진 구간은 태그가 목록인데 순서가 실행마다 달라서, 정렬한 첫 값을 씀 (결과 재현용)
    return sorted(map(str, v))[0] if isinstance(v, list) else v


def share_with_road(edges, raw_ind, polygon):
    """인도·횡단보도 구간의 시설 밀도 = max(자기 밀도, 옆 차도 밀도). 다른 구간은 그대로

    인도가 따로 그려진 차도(sidewalk=separate)는 OSMnx 보행망에서 빠지므로
    차도망(drive)을 따로 받아 밀도만 계산해서 비교한다. 경로 그래프는 그대로.
    """
    hw = edges["highway"].apply(first_tag)
    fw = edges["footway"].apply(first_tag) if "footway" in edges else pd.Series(None, index=edges.index)
    is_share = (hw == "footway") & fw.isin(SHARE_FOOTWAY)

    Gd = ox.project_graph(ox.graph_from_polygon(polygon, network_type="drive"), to_crs=CRS_M)
    roads = ox.graph_to_gdfs(Gd, nodes=False)
    roads = roads[roads["highway"].apply(first_tag).isin(ROAD_TYPES)]
    road_raw = {k: facility_density(roads, k, INDICATORS[k]) for k in ["light", "cctv", "shop"] if k in raw_ind}

    mid = gpd.GeoDataFrame(geometry=edges.loc[is_share].geometry.interpolate(0.5, normalized=True), crs=CRS_M)
    pair = gpd.sjoin_nearest(mid, roads[["geometry"]], max_distance=SHARE_MAX_DIST)
    pair = pair[~pair.index.duplicated()]               # 같은 거리 차도가 여럿이면 하나만
    road_idx = pd.MultiIndex.from_frame(pair[["u_right", "v_right", "key_right"]])
    for k, rv in road_raw.items():
        road_val = rv.loc[road_idx].values
        raw_ind[k].loc[pair.index] = np.maximum(raw_ind[k].loc[pair.index].values, road_val)
    # 짝지어진 차도 종류 (가로등 미반영 표시용)
    edges["paired_highway"] = None
    edges.loc[pair.index, "paired_highway"] = roads.loc[road_idx, "highway"].apply(first_tag).to_numpy()
    edges["streetlight_missing"] = hw.isin(BIG_ROADS) | edges["paired_highway"].isin(BIG_ROADS)
    print(f"[인도·횡단보도] {is_share.sum()}구간 중 {len(pair)}구간이 {SHARE_MAX_DIST}m 안 차도와 짝지어짐")


# ── 공공데이터가 없는 사유지·공원 구역 표시 (점수는 그대로) ──────────
# 아파트 단지·캠퍼스·학교 안 시설(CCTV·조명)은 사유지라 공공데이터에 없어서 점수가 낮게 나옴.
# 구간 중간점이 들어가는 구역을 area_type으로 붙이고, 겹치면 AREA_PRIORITY 순서로 정함
# 남구 밖(outside_namgu): 보안등·CCTV·상가 데이터가 남구 것만 있어서 분석 범위 중 수영구 쪽 등은 시설이 없는 것처럼 나옴
AREA_PRIORITY = ["outside_namgu", "campus", "school", "apartment", "park"]
NO_BLINDSPOT_AREAS = {"outside_namgu", "apartment", "campus", "school"}   # 사각지대 목록에서 뺄 구역
DATA_AREA_QUERY = "부산광역시 남구"   # 데이터가 있는 행정구역 (OSM 행정경계)


def osm_polygons(polygon, tags, with_names=False):
    try:
        f = ox.features_from_polygon(polygon, tags=tags)
    except ox._errors.InsufficientResponseError:   # 해당 태그 없음
        return (gpd.GeoSeries([], crs="EPSG:4326"), []) if with_names else gpd.GeoSeries([], crs="EPSG:4326")
    f = f[f.geom_type.isin(["Polygon", "MultiPolygon"])]
    if with_names:
        return f.geometry, f.get("name", pd.Series(dtype=object)).dropna().tolist()
    return f.geometry


def tag_set(v):
    if isinstance(v, list):
        return set(map(str, v))
    return {str(v)} if isinstance(v, str) else set()


def drop_unwalkable(Gp, polygon):
    """운전면허시험장 코스, 출입 금지 길(foot=yes·designated면 유지), 묘역 안 길을 보행망에서 뺌"""
    _, edges = ox.graph_to_gdfs(Gp)
    col = lambda c: edges[c] if c in edges else pd.Series(None, index=edges.index, dtype=object)
    by_service = col("service").apply(lambda v: bool(tag_set(v) & EXCLUDE_SERVICE))
    by_access = col("access").apply(lambda v: bool(tag_set(v) & NO_ACCESS)) & ~col("foot").apply(lambda v: bool(tag_set(v) & FOOT_OK))
    mid = edges.geometry.interpolate(0.5, normalized=True)
    inside = lambda shapes: mid.within(shapes.to_crs(CRS_M).union_all()) if len(shapes) else pd.Series(False, index=edges.index)
    cemetery, cem_names = osm_polygons(polygon, EXCLUDE_LANDUSE, with_names=True)
    by_landuse = inside(cemetery)
    try:
        timed = ox.features_from_polygon(polygon, tags={"opening_hours": True})
        timed = timed[timed.geom_type.isin(["Polygon", "MultiPolygon"]) & ~timed["opening_hours"].astype(str).str.contains("24/7")]
    except ox._errors.InsufficientResponseError:
        timed = gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
    by_hours = inside(timed.geometry)
    hour_names = [n for n, k in zip(timed.get("name", pd.Series(dtype=object)), timed.geometry.to_crs(CRS_M)) if mid.within(k).any()]
    drop = by_service | by_access | by_landuse | by_hours
    print(f"[보행망 정리] 운전면허시험장 코스 {by_service.sum()} / 출입 금지 {by_access.sum()} / 묘역 안 {by_landuse.sum()} "
          f"({', '.join(map(str, cem_names)) or '없음'}) / 이용 시간 있는 구역 안 {by_hours.sum()} ({', '.join(map(str, hour_names)) or '없음'}) "
          f"→ 합계 {drop.sum()}구간 뺌")
    Gp.remove_edges_from(edges.index[drop])
    Gp.remove_nodes_from(list(nx.isolates(Gp)))
    nodes, edges = ox.graph_to_gdfs(Gp)
    return Gp, nodes, edges


def tag_areas(edges, polygon):
    residential = osm_polygons(polygon, {"landuse": "residential"})
    apt_buildings = ox.features_from_polygon(polygon, tags={"building": "apartments"}).geometry
    # 아파트 건물이 하나라도 들어 있는 주거지역 = 아파트 단지
    has_apt = residential.apply(lambda g: apt_buildings.intersects(g).any()) if len(residential) else residential
    areas = {
        "campus": osm_polygons(polygon, {"amenity": ["university", "college"]}),
        "school": osm_polygons(polygon, {"amenity": "school"}),
        "apartment": residential[has_apt] if len(residential) else residential,
        "park": osm_polygons(polygon, {"leisure": "park"}),
    }
    mid = edges.geometry.interpolate(0.5, normalized=True)
    edges["area_type"] = None
    for kind in reversed(AREA_PRIORITY):   # 우선순위 높은 것이 마지막에 덮어씀
        if kind == "outside_namgu":
            boundary = ox.geocode_to_gdf(DATA_AREA_QUERY)
            outside = ~mid.within(boundary.to_crs(CRS_M).geometry.iloc[0])
            edges.loc[outside, "area_type"] = kind
            print(f"[구역] {kind}: 경계 '{boundary.iloc[0]['display_name']}' (OSM {boundary.iloc[0]['osm_type']} {boundary.iloc[0]['osm_id']})")
            continue
        shapes = areas[kind]
        if len(shapes):
            inside = mid.within(shapes.to_crs(CRS_M).union_all())
            edges.loc[inside, "area_type"] = kind
        print(f"[구역] {kind}: 폴리곤 {len(shapes)}개")
    edges["no_public_data"] = edges["area_type"].notna()
    edges["blindspot_exclude"] = edges["area_type"].isin(NO_BLINDSPOT_AREAS)
    share = edges.groupby(edges["area_type"].fillna("(없음)"))["length"].agg(["size", "sum"])
    share["구간 비율"] = (share["size"] / len(edges)).map("{:.1%}".format)
    share["길이 비율"] = (share["sum"] / edges["length"].sum()).map("{:.1%}".format)
    print(share[["size", "구간 비율", "길이 비율"]].to_string())


# ── 이용 빈도 (사각지대 우선순위용, 점수는 그대로) ─────────────────
# 분석 범위 안 무작위 출발·도착 USAGE_PAIRS쌍(직선 USAGE_MIN_M~USAGE_MAX_M, 시드 고정)의 최단 경로를
# 구하고, 구간마다 지나간 횟수를 셈. 같은 길 양방향(u→v, v→u)은 합쳐서 셈
USAGE_PAIRS = 1000
USAGE_MIN_M, USAGE_MAX_M = 300, 2000
USAGE_SEED = 20261126


def count_usage(Gp, nodes, edges):
    rng = np.random.default_rng(USAGE_SEED)
    ids = nodes.index.to_numpy()
    xy = nodes[["x", "y"]].to_numpy()
    counts = {}
    done = tries = no_path = 0
    while done < USAGE_PAIRS:
        tries += 1
        a, b = rng.integers(len(ids), size=2)
        d = np.hypot(*(xy[a] - xy[b]))
        if not (USAGE_MIN_M <= d <= USAGE_MAX_M):
            continue
        try:
            path = nx.shortest_path(Gp, ids[a], ids[b], weight="length")
        except nx.NetworkXNoPath:
            no_path += 1
            continue
        for u, v in zip(path, path[1:]):
            k = (u, v) if u < v else (v, u)
            counts[k] = counts.get(k, 0) + 1
        done += 1
    u = edges.index.get_level_values("u"); v = edges.index.get_level_values("v")
    edges["usage"] = [counts.get((a, b) if a < b else (b, a), 0) for a, b in zip(u, v)]
    print(f"[이용 빈도] {USAGE_PAIRS}쌍 (뽑은 횟수 {tries}, 길 없음 {no_path}), 한 번이라도 지나간 구간 {(edges['usage'] > 0).mean():.0%}")


# ── 경사도 (노트북 ⑤)────────────────────────────────────────
def slope_grade(nodes, edges):
    dem_path = CLEAN / INDICATORS["slope"]["file"]
    if not dem_path.exists():
        print("[slope] DEM 없음 → 건너뜀")
        return None
    import rasterio
    from pyproj import Transformer
    with rasterio.open(dem_path) as src:
        tf = Transformer.from_crs(CRS_M, src.crs, always_xy=True)
        xs, ys = tf.transform(nodes["x"].values, nodes["y"].values)
        z = np.array([v[0] for v in src.sample(zip(xs, ys))], dtype=float)
        z[z == src.nodata] = np.nan
    elev = pd.Series(z, index=nodes.index)
    u = edges.index.get_level_values("u"); v = edges.index.get_level_values("v")
    grade = np.abs(elev.loc[u].values - elev.loc[v].values) / edges["length"].clip(lower=MIN_LEN).values * 100
    s = pd.Series(grade, index=edges.index).fillna(0)
    print("경사도(%) 요약:"); print(s.describe().round(1))
    return s


# ── 정규화 + 안전점수 (노트북 ⑥) ─────────────────────────────
def normalize(s, higher_is_safer):
    hi = s.quantile(CLIP_Q)
    lo = s.min()
    x = ((s.clip(upper=hi) - lo) / (hi - lo)) if hi > lo else s * 0
    return x if higher_is_safer else 1 - x


def safety_score(raw_ind, weights):
    used = {k: w for k, w in weights.items() if k in raw_ind}
    total_w = sum(used.values())
    score = sum(normalize(raw_ind[k], INDICATORS[k]["higher_is_safer"]) * (w / total_w) for k, w in used.items())
    return score, {k: round(w / total_w, 3) for k, w in used.items()}


def to_grade(s):
    # 5등급 (분위수 기준: 범위 안에서 상대적인 순위) — 1 안전 ~ 5 위험
    return pd.qcut(s.rank(method="first"), 5, labels=[5, 4, 3, 2, 1]).astype(int)


# ── 민감도 분석 (노트북 ⑦) ───────────────────────────────────
def sensitivity(raw_ind, edges, paper_w):
    from scipy.stats import spearmanr
    scenarios = {
        "논문 가중치": paper_w,
        "동일 가중치": {k: 1 for k in INDICATORS},
        "조명·CCTV만": {"light": 1, "cctv": 1},
    }
    rows = []
    for name, w in scenarios.items():
        s, uw = safety_score(raw_ind, w)
        g = to_grade(s)
        rows.append({"시나리오": name, "적용 가중치": uw,
                     "순위 상관(논문 대비)": round(spearmanr(s, edges["safety"])[0], 3),
                     "등급 일치율": f"{(g == edges['grade']).mean():.0%}"})
    print(pd.DataFrame(rows).to_string(index=False))


# ── 결과 저장 (노트북 ⑩, CLAUDE.md 출력 형식) ────────────────
def save_edges(edges):
    out = edges[["length", "safety", "grade", "cost", "area_type", "no_public_data", "blindspot_exclude", "usage",
                 "paired_highway", "streetlight_missing", "geometry"]].reset_index().to_crs("EPSG:4326")
    out["highway"] = edges["highway"].apply(first_tag).to_numpy()
    out["name"] = edges["name"].apply(first_tag).to_numpy() if "name" in edges else None   # 도로 이름 (없으면 null)
    out["score"] = (out["safety"] * 100).round().astype(int)
    out["length"] = out["length"].round(2)
    out["safety"] = out["safety"].round(4)
    out["cost"] = out["cost"].round(2)
    out = out[["u", "v", "length", "safety", "score", "grade", "cost", "highway", "name", "paired_highway", "streetlight_missing",
               "area_type", "no_public_data", "blindspot_exclude", "usage", "geometry"]]
    path = OUT / "edges_scored.geojson"
    out.to_file(path, driver="GeoJSON", COORDINATE_PRECISION=6)
    print("저장:", path.relative_to(ROOT), "/", len(out), "구간")


def save_facilities():
    frames = []
    for t in FACILITY_TYPES:
        path = CLEAN / f"{t}_namgu.csv"
        if not path.exists():
            print(f"[{t}] 파일 없음 → facilities에서 빠짐")
            continue
        frames.append(pd.read_csv(path, encoding="utf-8-sig", dtype={"base_date": str}))
    df = pd.concat(frames, ignore_index=True)
    df = df.astype(object).where(df.notna(), None)
    features = [{
        "type": "Feature",
        "properties": {c: r[c] for c in ["id", "type", "name", "count", "base_date", "source", "note"]},
        "geometry": {"type": "Point", "coordinates": [float(r["lon"]), float(r["lat"])]},
    } for _, r in df.iterrows()]
    path = OUT / "facilities.geojson"
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, ensure_ascii=False)
    print("저장:", path.relative_to(ROOT), "/", df["type"].value_counts().to_dict())


def save_meta():
    datasets = {}
    for key, label in META_DATASETS.items():
        path = CLEAN / f"{key}_namgu.csv"
        if not path.exists():
            continue
        df = pd.read_csv(path, encoding="utf-8-sig", dtype={"base_date": str})
        datasets[key] = {
            "label": label,
            "base_date": df["base_date"].dropna().max(),          # 파일 안 가장 최근 기준일
            "source": df["source"].dropna().mode().iloc[0],
        }
    meta = {
        "datasets": datasets,
        "road": {"label": "도로망", "source": "OpenStreetMap", "downloaded": pd.Timestamp.now().strftime("%Y-%m-%d")},
    }
    path = OUT / "meta.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print("저장:", path.relative_to(ROOT), "/", {k: v["base_date"] for k, v in datasets.items()})


def main():
    Gp, nodes, edges, polygon = load_network()
    Gp, nodes, edges = drop_unwalkable(Gp, polygon)

    raw_ind = {}
    for key, cfg in INDICATORS.items():
        if key == "slope":
            continue
        v = facility_density(edges, key, cfg)
        if v is not None:
            raw_ind[key] = v
    share_with_road(edges, raw_ind, polygon)
    tag_areas(edges, polygon)
    count_usage(Gp, nodes, edges)
    s = slope_grade(nodes, edges)
    if s is not None:
        raw_ind["slope"] = s

    paper_w = {k: c["w"] for k, c in INDICATORS.items()}
    edges["safety"], used_w = safety_score(raw_ind, paper_w)
    edges["risk"] = 1 - edges["safety"]
    edges["cost"] = edges["length"] * (1 + edges["risk"])
    edges["grade"] = to_grade(edges["safety"])

    for c in ["cost", "risk", "safety", "grade"]:
        nx.set_edge_attributes(Gp, edges[c].to_dict(), c)
    print("실제 적용 가중치:", used_w)
    print(edges["safety"].describe().round(3))

    sensitivity(raw_ind, edges, paper_w)

    os.makedirs(OUT, exist_ok=True)
    save_edges(edges)
    save_facilities()
    save_meta()
    print("적용 가중치:", used_w, "/ 반경:", RADIUS_M, "m")


if __name__ == "__main__":
    main()
