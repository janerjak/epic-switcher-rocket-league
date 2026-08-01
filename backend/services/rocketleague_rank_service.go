package services

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type RocketLeagueRankService struct{}

func NewRocketLeagueRankService() *RocketLeagueRankService {
	return &RocketLeagueRankService{}
}

func (r *RocketLeagueRankService) GetRocketLeagueRankProfile(username string, platform string) (string, error) {
	username = strings.TrimSpace(username)
	platform = strings.TrimSpace(platform)

	if username == "" {
		return "", fmt.Errorf("username is required")
	}
	if platform == "" {
		platform = "epic"
	}

	scraperURL := strings.TrimSpace(os.Getenv("RANK_SCRAPER_URL"))
	if scraperURL == "" {
		scraperURL = "http://127.0.0.1:7331"
	}

	endpoint, err := url.Parse(strings.TrimRight(scraperURL, "/") + "/profile")
	if err != nil {
		return "", fmt.Errorf("invalid RANK_SCRAPER_URL: %w", err)
	}

	query := endpoint.Query()
	query.Set("platform", platform)
	query.Set("username", username)
	endpoint.RawQuery = query.Encode()

	req, err := http.NewRequest(http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("request tracker network: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read tracker response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("rank scraper returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	return string(body), nil
}
