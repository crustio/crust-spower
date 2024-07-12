#!/bin/bash

VERSION=$(grep '"version"' package.json | awk -F'"' '{print $4}')

sudo docker build -t crustio/crust-spower:$VERSION .
sudo docker tag crustio/crust-spower:$VERSION crustio/crust-spower:latest