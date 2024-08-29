#%%
import pandas as pd

#%%
PROJ_URL = "https://api.sleeper.com/projections/nfl/{}?season_type=regular&position%5B%5D=DEF&position%5B%5D=K&position%5B%5D=QB&position%5B%5D=RB&position%5B%5D=TE&position%5B%5D=WR&order_by=pts_half_ppr"
STATS_URL = "https://api.sleeper.com/stats/nfl/{}?season_type=regular&position%5B%5D=DEF&position%5B%5D=K&position%5B%5D=QB&position%5B%5D=RB&position%5B%5D=TE&position%5B%5D=WR&order_by=pts_half_ppr"
YEARS = [2022, 2023]
COLS = ["position", "pts_half_ppr", "player_id", "season", "category", "years_exp", "adp_half_ppr"]
POSITIONS = {
    "QB": 12,
    "RB": 24,
    "WR": 36,
    "TE": 12,
    "K": 12,
    "DEF": 12
}

#%%
def select_top_n(group):
    position = group.name
    n = POSITIONS.get(position, 12)  # Default to 12 if position not in dict
    return group.nsmallest(n, 'adp_half_ppr')
#%%
data = pd.DataFrame()
for y in YEARS:
    proj = pd.read_json(f"Data/sleeper_projections_{y}.json")
    proj2 = pd.json_normalize(proj.stats)
    proj3 = pd.json_normalize(proj.player)
    proj = pd.merge(
        proj.drop(["stats", "player"], axis=1), 
        pd.merge(
            proj2, proj3, left_index=True, right_index=True
            ), left_index=True, right_index=True
        )[COLS]

    proj = proj.groupby('position').apply(select_top_n)
    proj = proj.reset_index(drop=True)

    stats = pd.read_json(f"Data/sleeper_stats_{y}.json")
    stats2 = pd.json_normalize(stats.stats)
    stats3 = pd.json_normalize(stats.player)
    stats = pd.merge(stats.drop(["stats", "player"], axis=1), pd.merge(stats2, stats3, left_index=True, right_index=True), left_index=True, right_index=True)[["player_id", "pts_half_ppr"]]
    df = pd.merge(proj, stats, on="player_id", how="left")
    data = pd.concat([data, df])

# %%
data["difference"] = data.pts_half_ppr_y - data.pts_half_ppr_x
data["pos_med"] = data.position.apply(lambda x: data.loc[data.position == x, "pts_half_ppr_x"].median())
data["var"] = data.pts_half_ppr_x - data["pos_med"]

# %%
proj24 = pd.read_json("Data/sleeper_projections_2024.json")
proj24 = pd.merge(
    proj24.drop(["stats", "player"], axis=1),
    pd.merge(
        pd.json_normalize(proj24.stats),
        pd.json_normalize(proj24.player),
        left_index=True,
        right_index=True
    ),
    left_index=True,
    right_index=True
)
proj24 = proj24.groupby('position').apply(select_top_n)
proj24 = proj24.reset_index(drop=True)
proj24["pos_med"] = proj24.position.apply(lambda x: proj24.loc[proj24.position == x, "pts_half_ppr"].median())
proj24["var"] = proj24.pts_half_ppr - proj24["pos_med"]
proj24.to_csv("sleeper_projections_24.csv")
# %%
