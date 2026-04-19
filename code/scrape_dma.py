import re
from openpyxl import Workbook

content = '''# WEB.mil - Our Customers

## Site Categories

| Category | Description |
|----------|-------------|
| Department of War Websites | General DoD and War Department sites |
| Joint Websites | Unified combatant commands |
| Air Force Websites | Air Force bases, wings, and commands |
| Army Websites | Army divisions, commands, and installations |
| Army Corps of Engineers Websites | USACE districts and divisions |
| Marine Corps Websites | Marine units, expeditionary forces |
| Navy Websites | Fleet commands, naval installations |
| Coast Guard Websites | USCG areas and commands |
| National Guard Websites | State National Guard units |
| Space Force Websites | Space Force bases and commands |
| Defense Health Agency Websites | Military medical groups |

### Department of War / General DoD

| Site | URL |
|------|-----|
| All-Domain Anomaly Resolution Office | https://www.aaro.mil |
| American Forces Network | https://myafn.dodlive.mil |
| Defense Intelligence Agency | https://www.dia.mil |
| Defense Counterintelligence and Security Agency | https://www.dcsa.mil |
| Defense Logistics Agency | https://www.dla.mil |
| Defense POW/MIA Accounting Agency | https://www.dpaa.mil |
| DoD Inspector General | https://www.dodig.mil |
| Chief Digital and Artificial Intelligence Office | https://www.ai.mil |
| Chief Information Officer | https://dodcio.defense.gov |
| Defense Finance Accounting Service | https://www.dfas.mil |
| Defense Threat Reduction Agency | https://www.dtra.mil |

### Joint Commands

| Site | URL |
|------|-----|
| Joint Chiefs of Staff | https://www.jcs.mil |
| U.S. Central Command | https://www.centcom.mil |
| U.S. Cyber Command | https://www.cybercom.mil |
| U.S. Northern Command | https://www.northcom.mil |
| U.S. Pacific Command | https://www.pacom.mil |
| U.S. Space Command | https://www.spacecom.mil |
| U.S. Southern Command | https://www.southcom.mil |
| U.S. Strategic Command | https://www.stratcom.mil |
| Joint Task Force Guantanamo | https://www.jtfgtmo.southcom.mil |
| Joint Task Force-Bravo | https://www.jtfb.southcom.mil |

### Space Force

| Site | URL |
|------|-----|
| United States Space Force | https://www.spaceforce.mil |
| Buckley Space Force Base | https://www.buckley.spaceforce.mil/ |
| Los Angeles Space Force Base | https://www.losangeles.spaceforce.mil |
| Space Operations Command (SPOC) | https://www.spoc.spaceforce.mil |
| Space Systems Command | https://www.ssc.spaceforce.mil |
| Space Training and Readiness Command (STARCOM) | https://www.starcom.spaceforce.mil |
| Vandenberg Space Force Base | https://www.vandenberg.spaceforce.mil/ |

### Coast Guard

| Site | URL |
|------|-----|
| United States Coast Guard | https://www.uscg.mil |
| Atlantic Area | https://www.atlanticarea.uscg.mil |
| Pacific Area | https://www.pacificarea.uscg.mil |
| Reserve | https://www.reserve.uscg.mil |

### National Guard

| Site | URL |
|------|-----|
| National Guard | https://www.nationalguard.mil/ |
| Alabama National Guard | https://al.ng.mil |
| California National Guard | https://calguard.ng.mil |
| Florida National Guard | https://fl.ng.mil |
| Texas National Guard | https://t.ng.mil |
| Virginia National Guard | https://va.ng.mil |
'''

lines = content.split('\n')
data = []
current_category = ''

for line in lines:
    if line.startswith('### '):
        current_category = line.replace('### ', '').strip()
    elif line.startswith('|') and '---' not in line and 'Site' not in line and 'Category' not in line:
        parts = [p.strip() for p in line.split('|')]
        if len(parts) >= 3:
            description = parts[1].strip()
            url = parts[2].strip()
            if description and url and description not in ['Site', 'Description'] and url not in ['URL', 'site']:
                data.append({'Category': current_category, 'Description': description, 'URL': url})

print(f'Extracted {len(data)} records')

wb = Workbook()
ws = wb.active
ws.title = 'DMA Web Sites'
ws.append(['Category', 'Description', 'URL'])

for item in data:
    ws.append([item['Category'], item['Description'], item['URL']])

wb.save('/home/ubuntu/mulweb2.xlsx')
print('Saved to /home/ubuntu/mulweb2.xlsx')
