import { useState } from "react";
import {
    CUSTOM_INTEGER_MAX,
    CUSTOM_INTEGER_MIN,
    MAX_CUSTOM_VARIABLE_SLOTS,
    countVariableSlots,
    createExpressionCondition,
} from "../logic/BotBrain.js";

function clampNumber(value, min, max, fallback) {
    const text = String(value ?? "").trim();
    if (!text) return fallback;
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) return text.startsWith("-") ? min : max;
    return Math.max(min, Math.min(max, Math.round(numeric)));
}

function DeferredNumberInput({ value, onCommit, min, max, fallback = 0, ...props }) {
    const [draft, setDraft] = useState(String(value ?? fallback));
    const commit = () => {
        const normalized = clampNumber(draft, min, max, fallback);
        setDraft(String(normalized));
        onCommit(normalized);
    };
    return <input {...props} type="text" inputMode="numeric" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); event.currentTarget.blur(); } }} />;
}

export default function CustomVariablesModal({ configuration, currentValues, disabled, stateVariables, defaultVariable, targetTypes, onChange, onClose, renderConditionEditor }) {
    const variables = configuration?.customVariables ?? [];
    const slots = countVariableSlots(configuration);
    const update = (index, next) => onChange(updateCustomVariableConfiguration(configuration, index, next));
    const addVariable = () => onChange({ ...configuration, customVariables: [...variables, { id: `custom.${Date.now().toString(36)}`, name: `Variable ${variables.length + 1}`, valueType: "number", initialValue: 0 }] });
    return <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 p-6"><section className="flex h-[min(82vh,760px)] w-[min(94vw,1180px)] flex-col overflow-hidden rounded border border-emerald-900 bg-[#11171a] shadow-2xl">
        <header className="flex min-h-20 items-center justify-between px-6"><div><h2 className="font-mono text-sm font-bold tracking-widest text-cyan-300">{'{ }'} / CUSTOM VARIABLES</h2><p className="mt-2 font-mono text-[9px] text-ink-muted">{slots}/{MAX_CUSTOM_VARIABLE_SLOTS} VARIABLE SLOTS</p></div><div className="flex gap-3"><button type="button" disabled={disabled || slots >= MAX_CUSTOM_VARIABLE_SLOTS} onClick={addVariable} className="h-10 rounded border border-emerald-700 bg-emerald-950/60 px-5 font-mono text-[10px] font-bold tracking-widest text-emerald-300 disabled:opacity-35">+ ADD VARIABLE</button><button type="button" onClick={onClose} className="h-10 rounded border border-border-mid px-5 font-mono text-[10px] text-ink-mid">CLOSE&nbsp; ×</button></div></header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
            {!variables.length && <div className="flex h-full items-center justify-center font-mono text-[10px] tracking-widest text-ink-muted">NO CUSTOM VARIABLES YET</div>}
            {variables.map((variable, index) => <div key={variable.id} className="rounded border border-emerald-900/70 bg-zinc-950/45 p-4">
                <div className="grid grid-cols-[24px_1fr_140px_160px_160px_auto] items-end gap-4">
                    <span className="mb-2 cursor-grab font-mono text-lg leading-none text-ink-muted" aria-hidden="true">⠿</span>
                    <label className="font-mono text-[9px] text-ink-muted">NAME<input aria-label="Variable name" disabled={disabled} value={variable.name} maxLength={40} onChange={(event) => update(index, { name: event.target.value })} className="mt-1 h-9 w-full rounded border border-border-mid bg-zinc-950 px-3 font-mono text-[10px] text-white" /></label>
                    <label className="font-mono text-[9px] text-ink-muted">TYPE<select disabled={disabled} value={variable.valueType} onChange={(event) => update(index, { valueType: event.target.value, initialValue: event.target.value === "boolean" ? false : 0, conditions: [] })} className="mt-1 h-9 w-full rounded border border-border-mid bg-zinc-950 px-2 font-mono text-[10px] text-white"><option value="number">INTEGER</option><option value="boolean">BOOLEAN</option></select></label>
                    <label className="font-mono text-[9px] text-ink-muted">STARTING VALUE{variable.valueType === "boolean" ? <select disabled={disabled} value={String(variable.initialValue ?? false)} onChange={(event) => update(index, { initialValue: event.target.value === "true" })} className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[10px] text-white"><option value="false">FALSE</option><option value="true">TRUE</option></select> : <DeferredNumberInput key={variable.id} disabled={disabled} min={CUSTOM_INTEGER_MIN} max={CUSTOM_INTEGER_MAX} value={variable.initialValue ?? 0} onCommit={(initialValue) => update(index, { initialValue })} className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[10px] text-white" />}</label>
                    <label className="font-mono text-[9px] text-ink-muted">CURRENT VALUE<span className="mt-1 flex h-8 items-center rounded border border-emerald-900 bg-emerald-950/40 px-2 font-mono text-[10px] font-bold text-emerald-200">{String(currentValues?.[variable.id] ?? variable.initialValue)}</span></label>
                    <button type="button" disabled={disabled} onClick={() => onChange(removeCustomVariableConfiguration(configuration, variable.id))} className="h-8 rounded border border-red-900 px-3 font-mono text-[9px] text-red-300">DELETE</button>
                </div>
                {variable.valueType === "boolean" && <div className="mt-2 space-y-1">
                    {(variable.conditions ?? []).map((condition, conditionIndex) => renderConditionEditor({ key: conditionIndex, condition, prefix: conditionIndex ? (condition.join === "or" ? "OR" : "AND") : "SET", canChangeJoin: conditionIndex > 0, removable: true, stateVariables: stateVariables.filter((candidate) => candidate.id !== variable.id), defaultVariable, targetTypes, onChange: (next) => update(index, { conditions: variable.conditions.map((item, candidate) => candidate === conditionIndex ? next : item) }), onRemove: () => update(index, { conditions: variable.conditions.filter((_, candidate) => candidate !== conditionIndex) }) }))}
                    <button type="button" disabled={disabled || slots >= MAX_CUSTOM_VARIABLE_SLOTS} onClick={() => update(index, { conditions: [...(variable.conditions ?? []), createExpressionCondition(defaultVariable.id)] })} className="rounded border border-emerald-800 bg-emerald-950/40 px-4 py-2 font-mono text-[9px] text-emerald-300 disabled:opacity-35">+ DERIVED CONDITION (+1 VARIABLE, +1 CONDITION)</button>
                    <p className="font-mono text-[9px] leading-relaxed text-ink-muted">ⓘ Adding a derived conditional adds 1 to the variable slot and makes the cost of using this variable as a conditional increase by 1.</p>
                </div>}
            </div>)}
        </div>
        <footer className="border-t border-border-lo px-6 py-4 font-mono text-[9px] text-ink-muted">ⓘ Variables can be referenced by brain nodes. Current values update live during runtime.</footer>
    </section></div>;
}

function updateCustomVariableConfiguration(configuration, variableIndex, updates) {
    const variables = configuration?.customVariables ?? [];
    const current = variables[variableIndex];
    if (!current) return configuration;
    const typeChanged = updates.valueType && updates.valueType !== current.valueType;
    const customVariables = variables.map((variable, index) => index === variableIndex ? { ...variable, ...updates } : variable);
    if (!typeChanged) return { ...configuration, customVariables };
    return rewriteVariableActions({ ...configuration, customVariables }, current.id, (entry) => ({ ...entry, operation: "set", value: updates.valueType === "boolean" ? false : 0 }));
}

function removeCustomVariableConfiguration(configuration, variableId) {
    const customVariables = (configuration?.customVariables ?? []).filter((variable) => variable.id !== variableId).map((variable) => ({ ...variable, conditions: filterVariableConditions(variable.conditions, variableId) }));
    const cleaned = rewriteVariableActions({ ...configuration, customVariables }, variableId, () => null);
    return rewriteConfigurationConditions(cleaned, (conditions) => filterVariableConditions(conditions, variableId));
}

function rewriteVariableActions(configuration, variableId, rewrite) {
    const mapBranch = (branch) => {
        const actions = (branch.actions ?? []).map((entry) => entry.action === "variable" && entry.variableId === variableId ? rewrite(entry) : entry).filter(Boolean);
        const legacyMatches = branch.action === "variable" && branch.variableId === variableId;
        const first = actions[0] ?? (legacyMatches ? { action: "none", actionTarget: "opponent" } : null);
        return { ...branch, ...(first ? { ...first, actions } : { actions }), children: (branch.children ?? []).map(mapBranch) };
    };
    return { ...configuration, columns: (configuration.columns ?? []).map((column) => ({ ...column, branches: (column.branches ?? []).map(mapBranch) })), blocks: (configuration.blocks ?? []).map(mapBranch), clusters: (configuration.clusters ?? []).map((cluster) => ({ ...cluster, blocks: (cluster.blocks ?? []).map(mapBranch) })) };
}

function rewriteConfigurationConditions(configuration, rewrite) {
    const mapBranch = (branch) => ({ ...branch, conditions: rewrite(branch.conditions), children: (branch.children ?? []).map(mapBranch) });
    return { ...configuration, columns: (configuration.columns ?? []).map((column) => ({ ...column, branches: (column.branches ?? []).map(mapBranch) })), blocks: (configuration.blocks ?? []).map(mapBranch), clusters: (configuration.clusters ?? []).map((cluster) => ({ ...cluster, conditions: rewrite(cluster.conditions), blocks: (cluster.blocks ?? []).map(mapBranch) })) };
}

function filterVariableConditions(conditions, variableId) {
    return (conditions ?? []).filter((condition) => condition?.left !== variableId && condition?.right?.value !== variableId);
}
