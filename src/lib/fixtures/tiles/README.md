# Real map tiles for the sea-outline tests

Map tiles of the OpenStreetMap standard style, © OpenStreetMap contributors, available under the
[Open Database License](https://www.openstreetmap.org/copyright). Each one was downloaded once from
`https://tile.openstreetmap.org/{z}/{x}/{y}.png` (file name: `z{z}-{x}-{y}-{place}.png`) and is used
unchanged as test data for `src/lib/seaOutlines.ts`. Nothing fetches them at test time.

| File | What it has |
| --- | --- |
| `z4-8-4-scandinavia.png` | Maritime and land borders at a low zoom |
| `z7-73-49-aegean.png` | The rings of territorial waters around many islands |
| `z8-138-93-adriatic.png` | A ferry line lying along a border (the two mixed), a protected area's outline round an island |
| `z8-129-85-dover-strait.png` | Borders, protected areas and their labels, ferry lines, the Dover–Calais coast |
| `z9-266-165-wadden-sea.png` | Tidal flats: a large area whose colours are close to an outline's |
| `z10-565-300-stockholm.png` | Protected-area outlines and glows among the islands of an archipelago |
| `z10-516-342-channel-tunnel.png` | A railway tunnel under the sea (grey), a border, ferry lines |
| `z11-1076-765-bonifacio.png` | A border lying on a protected area, islets, a country label |
| `z12-2156-1431-lake-constance.png` | Borders across a lake, with the names of the states |
| `z13-4154-2738-de-panne.png` | Tidal flats and a protected-area outline along a coast |
