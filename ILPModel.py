#%%
import json
import pandas as pd
import pulp

from FantasyAnalysis import select_top_n, COLS

#%% Initialize the model
model = pulp.LpProblem("Fantasy_Football_Draft", pulp.LpMaximize)

#%% Define the positions and their requirements
positions = {
    'QB': 1,
    'RB': 2,
    'WR': 3,
    'TE': 1,
    'DEF': 1,
    'K': 1
}

#%% Data
proj = pd.read_json(f"Data/sleeper_projections_2023.json")
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

stats = pd.read_json(f"Data/sleeper_stats_2023.json")
stats2 = pd.json_normalize(stats.stats)
stats3 = pd.json_normalize(stats.player)
stats = pd.merge(stats.drop(["stats", "player"], axis=1), pd.merge(stats2, stats3, left_index=True, right_index=True), left_index=True, right_index=True)[["player_id", "pts_half_ppr"]]
data = pd.merge(proj, stats, on="player_id", how="left")
draft = pd.read_csv("Data/draft2023.csv")
data["key"] = data.apply(lambda x: x.first_name[0] + ". " + x.last_name, axis=1)
draft["key"] = draft.apply(lambda x: x.F + ". " + x.Last, axis=1)
data = pd.merge(data, draft, on="key", how="left")
data = data.dropna(subset=["pts_half_ppr_x", "Cost"])
data = data.drop(data.loc[(data.key == "B. Robinson") & (data.Cost == 4)].index[0])
players = json.loads(data.to_json(orient="records"))

#%% Create variables
x = pulp.LpVariable.dicts("select", 
                          ((player['key'], player['position']) for player in players), 
                          cat='Binary')

#%% Objective function
model += pulp.lpSum(player['pts_half_ppr_x'] * x[player['key'], player['position']] for player in players)

#%% Budget constraint
model += pulp.lpSum(player['Cost'] * x[player['key'], player['position']] for player in players) <= 200

#%% Position constraints
for position, count in positions.items():
    model += pulp.lpSum(x[player['key'], player['position']] 
                        for player in players if player['position'] == position) == count

#%% Solve the model
model.solve()

#%% Print the results
print("Status:", pulp.LpStatus[model.status])
for player in players:
    if x[player['key'], player['position']].value() == 1:
        print(f"Draft {player['key']} ({player['position']}) for ${player['Cost']}")

print("Total projected points:", pulp.value(model.objective))
# %%
