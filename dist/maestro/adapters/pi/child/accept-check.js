import { ACCEPT_CHILD_OUTPUT_CHARS, ACCEPT_RETRY_MESSAGE_TYPE, outputTail, } from "../../../core/accept.js";
import { runAcceptCommand } from "../accept-runner.js";
import { terminateAcceptChecks } from "../accept-groups.js";
function failureText(result, spec) {
    switch (result.kind) {
        case "exit":
            return `exited with code ${result.exitCode}`;
        case "timeout":
            return `timed out after ${spec.timeoutSec}s`;
        case "signal":
            return `was killed by signal ${result.signal}`;
        case "cwd-missing":
            return "could not run: its directory is missing";
        case "spawn-error":
            return `could not start: ${result.error}`;
        default:
            return "was stopped";
    }
}
/** The retry message the child model reads; its output is bounded. */
export function acceptRetryMessage(result, spec, tries) {
    const tail = outputTail(result.output, ACCEPT_CHILD_OUTPUT_CHARS);
    return [
        `The accept check \`${spec.run}\` ${failureText(result, spec)} (try ${tries} of ${spec.maxRetries + 1}).`,
        "Fix the cause, then finish your task again. The check runs again when you finish, and the parent re-runs it to decide the verdict.",
        "",
        `Last ${ACCEPT_CHILD_OUTPUT_CHARS.toLocaleString("en-US")} characters of check output:`,
        "```",
        tail || "(no output)",
        "```",
    ].join("\n");
}
export function createChildAcceptLoop(options) {
    const { spec, cwd } = options;
    const runner = options.runner ?? runAcceptCommand;
    let tries = 0;
    let report;
    const owner = { label: "child accept loop" };
    return {
        report: () => report,
        shutdown: () => terminateAcceptChecks(owner),
        async beforeSettle(event, signal) {
            if (event.outcome !== "completed")
                return undefined;
            const result = await runner({
                run: spec.run,
                cwd,
                timeoutMs: spec.timeoutSec * 1000,
                signal,
                owner,
            });
            // A user abort during the check is no verdict and no try.
            if (result.kind === "aborted")
                return undefined;
            tries++;
            const passed = result.kind === "exit" && result.exitCode === 0;
            report = {
                tries,
                childVerdict: passed ? "passed" : "failed",
                timedOut: result.kind === "timeout",
            };
            if (result.kind === "exit")
                report.lastExitCode = result.exitCode;
            if (passed || tries > spec.maxRetries)
                return undefined;
            return {
                entries: [
                    ...event.entries,
                    {
                        type: "custom_message",
                        customType: ACCEPT_RETRY_MESSAGE_TYPE,
                        content: acceptRetryMessage(result, spec, tries),
                        display: true,
                        details: { tries, exitCode: report.lastExitCode },
                    },
                ],
                continue: true,
            };
        },
    };
}
//# sourceMappingURL=accept-check.js.map