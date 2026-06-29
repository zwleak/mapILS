import urllib.request
import csv
import io
import json
import os

# URLs
AIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
RUNWAYS_URL = "https://davidmegginson.github.io/ourairports-data/runways.csv"
NAVAIDS_URL = "https://raw.githubusercontent.com/laegsgaardTroels/whatisflying-db/master/data/navaids.csv"

def download_csv(url):
    print(f"Downloading {url}...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as response:
        content = response.read().decode('utf-8')
    return list(csv.DictReader(io.StringIO(content)))

def main():
    try:
        # Create data folder if it doesn't exist
        os.makedirs("data", exist_ok=True)

        print("Downloading raw files...")
        navaids_raw = download_csv(NAVAIDS_URL)
        airports_raw = download_csv(AIRPORTS_URL)
        runways_raw = download_csv(RUNWAYS_URL)
        
        print("Processing airports...")
        # Build index of airports
        airports = {}
        for row in airports_raw:
            # We want medium and large airports, or any airport with ICAO code
            icao = row['ident']
            if not icao:
                continue
            
            # Filter out closed airports
            if row.get('type') == 'closed':
                continue
                
            airports[icao] = {
                "icao": icao,
                "iata": row.get('iata_code', '').upper(),
                "name": row.get('name', ''),
                "city": row.get('municipality', ''),
                "country": row.get('iso_country', ''),
                "lat": float(row['latitude_deg']) if row.get('latitude_deg') else 0.0,
                "lon": float(row['longitude_deg']) if row.get('longitude_deg') else 0.0,
                "elev": int(float(row['elevation_ft'])) if row.get('elevation_ft') else 0,
                "runways": []
            }
            
        print("Processing ILS navaids...")
        # We group navaids by airport, then by identifier
        ils_groups = {}
        for row in navaids_raw:
            # Keep ILS/LOC related types
            nav_type = row['type']
            if nav_type not in ('ILS-I', 'ILS-II', 'ILS-III', 'LOC', 'IGS', 'LDA', 'SDF', 'DME-ILS', 'GS'):
                continue
                
            icao = row['airport']
            if not icao or icao not in airports:
                continue
                
            ident = row['identifier']
            if not ident:
                continue
                
            if icao not in ils_groups:
                ils_groups[icao] = {}
                
            if ident not in ils_groups[icao]:
                ils_groups[icao][ident] = []
                
            ils_groups[icao][ident].append(row)
            
        # For each airport, consolidate the ILS groups into runway end mappings
        # Key: airport ICAO -> Key: runway_end -> ILS info
        consolidated_ils = {}
        for icao, idents in ils_groups.items():
            consolidated_ils[icao] = {}
            for ident, rows in idents.items():
                # Extract details
                freq_val = ""
                rwy_val = ""
                hdg_val = ""
                gs_val = ""
                best_type = "ILS"
                
                # Determine fields from rows in this identifier group
                for r in rows:
                    if r.get('frequency') and not freq_val:
                        # Convert khz string to float mhz string
                        try:
                            khz = float(r['frequency'])
                            freq_val = f"{khz / 1000.0:.2f}"
                        except:
                            freq_val = r['frequency']
                            
                    if r.get('airport_runway') and not rwy_val:
                        rwy_val = r['airport_runway'].upper()
                        
                    if r.get('localizer_heading') and not hdg_val:
                        try:
                            hdg_val = round(float(r['localizer_heading']), 1)
                        except:
                            pass
                            
                    if r.get('glide_slope_angle') and not gs_val:
                        try:
                            gs_val = float(r['glide_slope_angle'])
                        except:
                            pass
                            
                    # Get the most descriptive type
                    t = r['type']
                    if t in ('ILS-III', 'ILS-II', 'ILS-I'):
                        best_type = t
                    elif t == 'LOC' and best_type == 'ILS':
                        best_type = 'LOC'
                    elif t == 'IGS' and best_type == 'ILS':
                        best_type = 'IGS'
                    elif t == 'LDA' and best_type == 'ILS':
                        best_type = 'LDA'
                    elif t == 'SDF' and best_type == 'ILS':
                        best_type = 'SDF'
                        
                # If we have a runway end, associate it
                if rwy_val:
                    # If there's multiple for the same runway end (like DME-ILS and GS and ILS-III)
                    # We merge them
                    if rwy_val not in consolidated_ils[icao]:
                        consolidated_ils[icao][rwy_val] = {
                            "id": ident,
                            "freq": freq_val,
                            "type": best_type,
                            "hdg": hdg_val,
                            "gs": gs_val
                        }
                    else:
                        # Merge values if not present
                        existing = consolidated_ils[icao][rwy_val]
                        if not existing["freq"]:
                            existing["freq"] = freq_val
                        if not existing["hdg"] and hdg_val:
                            existing["hdg"] = hdg_val
                        if not existing["gs"] and gs_val:
                            existing["gs"] = gs_val
                        # Pick more specific type
                        if best_type in ('ILS-III', 'ILS-II', 'ILS-I'):
                            existing["type"] = best_type
                else:
                    # No runway end specified, store by identifier temporarily
                    # We will try to match this to runways later based on heading
                    no_rwy_key = f"_ident_{ident}"
                    consolidated_ils[icao][no_rwy_key] = {
                        "id": ident,
                        "freq": freq_val,
                        "type": best_type,
                        "hdg": hdg_val,
                        "gs": gs_val
                    }

        print("Processing runways...")
        # Group runways by airport
        airport_runways = {}
        for r in runways_raw:
            icao = r['airport_ident']
            if not icao or icao not in airports:
                continue
                
            if r.get('closed') == '1':
                continue
                
            if icao not in airport_runways:
                airport_runways[icao] = []
                
            airport_runways[icao].append(r)
            
        # Combine everything
        final_airports = {}
        for icao, ap in airports.items():
            # Get runways for this airport
            r_list = airport_runways.get(icao, [])
            ils_map = consolidated_ils.get(icao, {})
            
            # If this airport has no ILS at all, skip it!
            if not ils_map:
                continue
                
            # Compile runways with ILS data
            compiled_runways = []
            for r in r_list:
                le = r['le_ident'].upper() if r.get('le_ident') else ""
                he = r['he_ident'].upper() if r.get('he_ident') else ""
                
                if not le and not he:
                    continue
                    
                # Find ILS for low elevation end
                le_ils = ils_map.get(le, None)
                # Find ILS for high elevation end
                he_ils = ils_map.get(he, None)
                
                # Check for unlinked ILS items (e.g. keys starting with _ident_)
                # and see if their heading matches the runway heading
                for key, val in list(ils_map.items()):
                    if key.startswith("_ident_"):
                        val_hdg = val.get("hdg")
                        if val_hdg is not None and val_hdg != "":
                            try:
                                val_hdg_float = float(val_hdg)
                                # Check low elevation end heading
                                if r.get('le_heading_degT') and r['le_heading_degT'] != "":
                                    le_hdg = float(r['le_heading_degT'])
                                    if abs((val_hdg_float - le_hdg + 180) % 360 - 180) < 15:  # within 15 degrees
                                        le_ils = val
                                        del ils_map[key]
                                        break
                                # Check high elevation end heading
                                if r.get('he_heading_degT') and r['he_heading_degT'] != "":
                                    he_hdg = float(r['he_heading_degT'])
                                    if abs((val_hdg_float - he_hdg + 180) % 360 - 180) < 15:
                                        he_ils = val
                                        del ils_map[key]
                                        break
                            except Exception as heading_err:
                                pass
                
                # We only keep runways that are usable (have identifiers)
                # And we list their details
                runway_data = {
                    "ident": f"{le}/{he}" if (le and he) else (le or he),
                    "len": int(float(r['length_ft'])) if r.get('length_ft') else 0,
                    "wid": int(float(r['width_ft'])) if r.get('width_ft') else 0,
                    "surf": r.get('surface', 'Unknown'),
                    "ils": {}
                }
                
                if le and le_ils:
                    runway_data["ils"][le] = le_ils
                if he and he_ils:
                    runway_data["ils"][he] = he_ils
                    
                compiled_runways.append(runway_data)
                
            # Wait, did we find any ILS on these runways?
            # Or are there general ILS items that couldn't be associated with a runway?
            # Let's count how many ILS frequencies we actually associated
            ils_count = sum(len(rw["ils"]) for rw in compiled_runways)
            
            # If we couldn't associate any ILS with runways, but we have some unlinked ones,
            # let's create a "generic" runway entry or associate it with the first runway
            if ils_count == 0 and ils_map:
                # Add all remaining ILS elements under a custom runway card
                generic_ils = {}
                for key, val in ils_map.items():
                    if key.startswith("_ident_"):
                        generic_ils[val["id"]] = val
                    else:
                        generic_ils[key] = val
                
                if generic_ils:
                    runway_data = {
                        "ident": "ILS/LOC Info",
                        "len": 0,
                        "wid": 0,
                        "surf": "N/A",
                        "ils": generic_ils
                    }
                    compiled_runways.append(runway_data)
                    ils_count = len(generic_ils)
                    
            # If this airport ended up with zero ILS records, skip it!
            if ils_count == 0:
                continue
                
            ap["runways"] = compiled_runways
            final_airports[icao] = ap
            
        print(f"Total compiled airports: {len(final_airports)}")
        
        # Write to JSON file
        out_path = "data/airports.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(final_airports, f, ensure_ascii=False)
            
        print(f"Success! Saved data to {out_path}")
        
    except Exception as e:
        print(f"Error in compilation: {e}")

if __name__ == "__main__":
    main()
