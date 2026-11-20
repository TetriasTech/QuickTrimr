-- P2-T03: bounded OLTP work does not benefit from LLVM compilation. Match
-- hosted 17.12's default for this function without changing the local cluster.
begin;
alter function private.run_available_now_expiry() set jit=off;
commit;
