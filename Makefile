MINIKUBE_PROFILE ?= minikube
NS ?= s1ie
IMAGE ?= s1ie-exams:local

minikube-env:
	@eval "$$(minikube -p $(MINIKUBE_PROFILE) docker-env)" && echo "Using minikube docker-env"

build-minikube:
	@eval "$$(minikube -p $(MINIKUBE_PROFILE) docker-env)" && docker build -t $(IMAGE) .

apply-minikube:
	kubectl apply -k k8s/overlays/minikube

restart:
	kubectl -n $(NS) rollout restart deploy/s1ie-exams

url:
	minikube service -n $(NS) s1ie-exams --url

health:
	@URL="$$(minikube service -n $(NS) s1ie-exams --url)" && echo $$URL && curl -I "$$URL/healthz"
