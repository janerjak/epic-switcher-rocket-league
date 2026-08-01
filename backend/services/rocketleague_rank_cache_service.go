package services

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"epic-games-account-switcher/backend/utils"
)

type RocketLeagueRankCacheService struct {
	filePath string
}

func NewRocketLeagueRankCacheService() *RocketLeagueRankCacheService {
	return &RocketLeagueRankCacheService{
		filePath: filepath.Join(utils.GetAppDataPath(), "rocketleague_rank_cache.json"),
	}
}

func (s *RocketLeagueRankCacheService) ensureFile() error {
	dir := filepath.Dir(s.filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	if _, err := os.Stat(s.filePath); os.IsNotExist(err) {
		return os.WriteFile(s.filePath, []byte(`{"version":1,"accounts":{}}`), 0644)
	}

	return nil
}

func (s *RocketLeagueRankCacheService) LoadRankCache() (string, error) {
	if err := s.ensureFile(); err != nil {
		return "", fmt.Errorf("ensure rank cache: %w", err)
	}

	data, err := os.ReadFile(s.filePath)
	if err != nil {
		return "", fmt.Errorf("read rank cache: %w", err)
	}

	if !json.Valid(data) {
		return `{"version":1,"accounts":{}}`, nil
	}

	return string(data), nil
}

func (s *RocketLeagueRankCacheService) SaveRankCache(cacheJSON string) error {
	if err := s.ensureFile(); err != nil {
		return fmt.Errorf("ensure rank cache: %w", err)
	}

	if cacheJSON == "" {
		cacheJSON = `{"version":1,"accounts":{}}`
	}

	if !json.Valid([]byte(cacheJSON)) {
		return fmt.Errorf("invalid rank cache JSON")
	}

	return os.WriteFile(s.filePath, []byte(cacheJSON), 0644)
}
