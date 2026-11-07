# T8 external prerequisites

1. **MUST** Publish T1's sharded workflow on the repository default branch using
   the owner's normal review process. Dispatch currently returns HTTP 404. T8
   must not push main and must not edit GitHub workflows.
2. **MUST** Implement and audit committed pre-dispatch claim, source/input/job
   freeze, infrastructure-only retry ledger and merge-time second-attempt
   refusal before removing the fail-closed sharded sealed guard.
3. **MUST** Finish the delivered track acceptance populations and calibrated
   uncertainty. No T4 lever has accepted full train/validation evidence.
4. **MUST** Supply real measured observation extraction/interfaces for notch,
   Doppler and sound-speed consumers; do not wire synthetic source truth into
   the restricted sensor path.
5. **OPTIONAL** Deliver causal and buildings branches for a later explicitly
   preregistered integration round. They are excluded from this delivery.
6. **MUST before promotion** Resolve the delivered T4 `measured_*` naming
   deviation from the requested `fus_*` prefix, retaining explicit backwards
   compatibility and updating preregistrations rather than renaming silently.
   The existing legacy fusion selector remains the default.
