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
    return Gp, nodes, edges


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


# ── 경사도 (노트북 ⑤) ────────────────────────────────────────
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
    out = edges[["length", "safety", "grade", "cost", "geometry"]].reset_index().to_crs("EPSG:4326")
    out["score"] = (out["safety"] * 100).round().astype(int)
    out["length"] = out["length"].round(2)
    out["safety"] = out["safety"].round(4)
    out["cost"] = out["cost"].round(2)
    out = out[["u", "v", "length", "safety", "score", "grade", "cost", "geometry"]]
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
    Gp, nodes, edges = load_network()

    raw_ind = {}
    for key, cfg in INDICATORS.items():
        if key == "slope":
            continue
        v = facility_density(edges, key, cfg)
        if v is not None:
            raw_ind[key] = v
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
