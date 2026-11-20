/** Whether the parent appends one outcome-ledger line per model attempt. */
export interface OutcomeLedgerConfig {
    enabled: boolean;
}
/** `outcomeLedger` is on unless set to `false`; any non-boolean is rejected. */
export declare function parseOutcomeLedgerConfig(rawConfig: any, source?: string): OutcomeLedgerConfig;
export declare function loadOutcomeLedgerConfig(configDir: string, examplePath: string): OutcomeLedgerConfig;
//# sourceMappingURL=outcome-ledger-config.d.ts.map