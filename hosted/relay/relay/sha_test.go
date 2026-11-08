package relay

import "crypto/sha256"

func sha256Sum(s string) [32]byte { return sha256.Sum256([]byte(s)) }
