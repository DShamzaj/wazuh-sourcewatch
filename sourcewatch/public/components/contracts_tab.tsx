import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiBasicTable,
  EuiButton,
  EuiButtonEmpty,
  EuiComboBox,
  EuiFieldText,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiFlyoutHeader,
  EuiForm,
  EuiFormRow,
  EuiHealth,
  EuiSpacer,
  EuiSwitch,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { CoreStart } from '../../../../src/core/public';
import { API_BASE } from '../../common';
import { errMsg, sourceLabel } from './shared';

interface Props {
  http: CoreStart['http'];
  notifications: CoreStart['notifications'];
  sources: any[];
  onChanged: () => void;
}

const toOption = (r: { location: string; channel?: string | null }) => ({
  label: sourceLabel(r.location, r.channel),
  value: JSON.stringify({ location: r.location, channel: r.channel ?? null }),
});

const ContractEditor = ({
  initial,
  sources,
  http,
  notifications,
  onClose,
  onSaved,
}: {
  initial: any;
  sources: any[];
  http: CoreStart['http'];
  notifications: CoreStart['notifications'];
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [name, setName] = useState<string>(initial.name);
  const [group, setGroup] = useState<string>(initial.group);
  const [enabled, setEnabled] = useState<boolean>(initial.enabled !== false);
  const [selected, setSelected] = useState<any[]>((initial.required ?? []).map(toOption));
  const [saving, setSaving] = useState(false);

  const options = useMemo(() => {
    const unique = new Map<string, any>();
    sources.forEach((s) => {
      const o = toOption(s);
      unique.set(o.value, o);
    });
    return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [sources]);

  const onCreate = (text: string) => {
    const [location, channel] = text.split(' | ').map((t) => t.trim());
    if (!location) return;
    const o = toOption({ location, channel: channel || null });
    setSelected((prev) => (prev.some((p) => p.value === o.value) ? prev : [...prev, o]));
  };

  const nameValid = /^[A-Za-z0-9_-]{1,64}$/.test(name);
  const canSave = nameValid && group.trim().length > 0 && selected.length > 0;

  const save = async () => {
    setSaving(true);
    try {
      await http.put(`${API_BASE}/contracts/${name}`, {
        body: JSON.stringify({
          group: group.trim(),
          enabled,
          required: selected.map((o) => JSON.parse(o.value)),
        }),
      });
      notifications.toasts.addSuccess(`Contract "${name}" saved. It applies from the next cycle.`);
      onSaved();
    } catch (e) {
      notifications.toasts.addDanger(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <EuiFlyout onClose={onClose} size="s" ownFocus>
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="m">
          <h2>{initial.isNew ? 'New contract' : `Edit contract ${initial.name}`}</h2>
        </EuiTitle>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        <EuiForm component="div">
          <EuiFormRow
            label="Name"
            helpText="Letters, digits, _ or -"
            isInvalid={name.length > 0 && !nameValid}
            error="Use letters, digits, _ or - (max 64)"
          >
            <EuiFieldText
              value={name}
              disabled={!initial.isNew}
              onChange={(e) => setName(e.target.value)}
              placeholder="windows-dc-baseline"
            />
          </EuiFormRow>
          <EuiFormRow
            label="Wazuh agent group"
            helpText="Every active agent in this group must send the sources below."
          >
            <EuiFieldText
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder="default"
            />
          </EuiFormRow>
          <EuiFormRow
            label="Required log sources"
            helpText="Pick discovered sources, or type one as 'location' or 'location | channel' (e.g. EventChannel | Security) and press Enter."
          >
            <EuiComboBox
              options={options}
              selectedOptions={selected}
              onChange={(opts: any[]) => setSelected(opts)}
              onCreateOption={onCreate}
              placeholder="Select or type sources"
            />
          </EuiFormRow>
          <EuiFormRow>
            <EuiSwitch
              label="Enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </EuiFormRow>
        </EuiForm>
      </EuiFlyoutBody>
      <EuiFlyoutFooter>
        <EuiFlexGroup justifyContent="spaceBetween">
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty onClick={onClose}>Cancel</EuiButtonEmpty>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton fill isDisabled={!canSave} isLoading={saving} onClick={save}>
              Save contract
            </EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutFooter>
    </EuiFlyout>
  );
};

export const ContractsTab = ({ http, notifications, sources, onChanged }: Props) => {
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r: any = await http.get(`${API_BASE}/contracts`);
      setContracts(r.contracts);
    } catch (e) {
      notifications.toasts.addDanger(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [http, notifications]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (c: any) => {
    if (!window.confirm(`Delete contract "${c.name}"? Its Missing sources will be removed on the next cycle.`)) {
      return;
    }
    try {
      await http.delete(`${API_BASE}/contracts/${c.name}`);
      notifications.toasts.addSuccess(`Contract "${c.name}" deleted`);
      load();
      onChanged();
    } catch (e) {
      notifications.toasts.addDanger(errMsg(e));
    }
  };

  const columns = [
    { field: 'name', name: 'Name' },
    { field: 'group', name: 'Agent group' },
    {
      field: 'required',
      name: 'Required sources',
      render: (req: any[]) => (
        <EuiFlexGroup wrap gutterSize="xs" responsive={false}>
          {(req ?? []).map((r) => (
            <EuiFlexItem grow={false} key={sourceLabel(r.location, r.channel)}>
              <EuiBadge color="hollow">{sourceLabel(r.location, r.channel)}</EuiBadge>
            </EuiFlexItem>
          ))}
        </EuiFlexGroup>
      ),
    },
    {
      field: 'enabled',
      name: 'Status',
      width: '100px',
      render: (en: boolean) => (
        <EuiHealth color={en !== false ? 'success' : 'subdued'}>
          {en !== false ? 'Enabled' : 'Disabled'}
        </EuiHealth>
      ),
    },
    {
      name: 'Actions',
      width: '100px',
      actions: [
        {
          name: 'Edit',
          description: 'Edit this contract',
          icon: 'pencil',
          type: 'icon',
          onClick: (c: any) => setEditing({ ...c, isNew: false }),
        },
        {
          name: 'Delete',
          description: 'Delete this contract',
          icon: 'trash',
          type: 'icon',
          color: 'danger',
          onClick: remove,
        },
      ],
    },
  ];

  return (
    <>
      <EuiFlexGroup justifyContent="spaceBetween" alignItems="center">
        <EuiFlexItem>
          <EuiText size="s" color="subdued">
            <p>
              A contract lists the log sources that every active agent in a Wazuh group must send.
              A required source that has never been seen is flagged as Missing.
            </p>
          </EuiText>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButton
            fill
            iconType="plusInCircle"
            onClick={() =>
              setEditing({ name: '', group: '', enabled: true, required: [], isNew: true })
            }
          >
            New contract
          </EuiButton>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer />
      <EuiBasicTable
        items={contracts}
        columns={columns as any}
        loading={loading}
        noItemsMessage="No contracts yet"
      />
      {editing && (
        <ContractEditor
          initial={editing}
          sources={sources}
          http={http}
          notifications={notifications}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            onChanged();
          }}
        />
      )}
    </>
  );
};
