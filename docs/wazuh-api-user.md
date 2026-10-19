# Dedicated Wazuh API user for SourceWatch

SourceWatch calls the Wazuh server API for two things only:

| Purpose | Endpoint | Permission |
|---|---|---|
| Send state changes to the analysis engine (native alerts) | `POST /events` | `event:ingest` |
| Resolve agent groups for contracts | `GET /agents` | `agent:read` |

Rather than using an administrator account, create a dedicated user with just these permissions.
Run the commands below on (or against) the Wazuh manager. `jq` is required.

```bash
API=https://localhost:55000
TOKEN=$(curl -sk -u <admin-user>:<admin-password> -X POST "$API/security/user/authenticate?raw=true")
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

# 1. Policies
P1=$(curl -sk "${H[@]}" -X POST "$API/security/policies" -d '{
  "name": "sourcewatch_ingest",
  "policy": { "actions": ["event:ingest"], "resources": ["*:*:*"], "effect": "allow" }
}' | jq -r '.data.affected_items[0].id')

P2=$(curl -sk "${H[@]}" -X POST "$API/security/policies" -d '{
  "name": "sourcewatch_agents",
  "policy": { "actions": ["agent:read"], "resources": ["agent:id:*", "agent:group:*"], "effect": "allow" }
}' | jq -r '.data.affected_items[0].id')

# 2. Role with both policies
ROLE=$(curl -sk "${H[@]}" -X POST "$API/security/roles" -d '{"name":"sourcewatch"}' \
  | jq -r '.data.affected_items[0].id')
curl -sk "${H[@]}" -X POST "$API/security/roles/$ROLE/policies?policy_ids=$P1,$P2"

# 3. User linked to the role (password must meet Wazuh complexity rules)
USER=$(curl -sk "${H[@]}" -X POST "$API/security/users" \
  -d '{"username":"sourcewatch","password":"<Strong-Passw0rd!>"}' \
  | jq -r '.data.affected_items[0].id')
curl -sk "${H[@]}" -X POST "$API/security/users/$USER/roles?role_ids=$ROLE"
```

Then set `sourcewatch.wazuhApi.username: "sourcewatch"` and the password in `opensearch_dashboards.yml`.

See the Wazuh documentation on RBAC for details: https://documentation.wazuh.com/current/user-manual/api/rbac/index.html
