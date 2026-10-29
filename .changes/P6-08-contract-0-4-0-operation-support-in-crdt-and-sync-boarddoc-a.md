area: sync
kind: minor

Contract 0.4.0 operation support in crdt and sync: BoardDoc applies updateNoteBody (structured body + derived plainText, contract-shape validation, missing-note rejection, byte-identical inverse), snapshots/convergence/10k conformance cover bodies for both adapters, the sync log validates/acks/persists/broadcasts/replays body batches with a live-socket and restart-harness proof, and sync+sdk negotiate contract 0.4.0.
