use illama_lib::monitor::parse_prometheus_metrics;

#[test]
fn parses_llama_server_token_speed_metrics() {
    let metrics = parse_prometheus_metrics(
        r#"
# HELP llama prompt throughput
llamacpp:prompt_tokens_seconds 44.5
llamacpp:predicted_tokens_seconds 18.25
llamacpp:kv_cache_usage_ratio 0.42
"#,
    );

    assert_eq!(metrics.prompt_tokens_per_second, Some(44.5));
    assert_eq!(metrics.tokens_per_second, Some(18.25));
    assert_eq!(metrics.kv_cache_usage_ratio, Some(0.42));
}

#[test]
fn parses_alternate_prometheus_metric_names() {
    let metrics = parse_prometheus_metrics(
        r#"
llama_kv_cache_usage_ratio 0.77
llamacpp_prompt_tokens_seconds 12
llamacpp_generation_tokens_seconds 9
"#,
    );
    assert_eq!(metrics.kv_cache_usage_ratio, Some(0.77));
    assert_eq!(metrics.prompt_tokens_per_second, Some(12.0));
    assert_eq!(metrics.tokens_per_second, Some(9.0));
}
